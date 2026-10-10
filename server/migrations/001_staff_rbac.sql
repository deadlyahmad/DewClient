ALTER TABLE public.dew_admins
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE public.dew_admins
    ADD COLUMN IF NOT EXISTS session_version BIGINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.dew_cosmetic_library (
    asset_id TEXT PRIMARY KEY REFERENCES public.dew_cosmetic_assets(sha256) ON DELETE CASCADE,
    sha256 TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('skin', 'cape', 'elytra')),
    content_type TEXT NOT NULL DEFAULT 'image/png',
    byte_size INT NOT NULL,
    width INT,
    height INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dew_cosmetic_library_kind ON public.dew_cosmetic_library(kind);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dew_admins_role_check' AND conrelid = 'public.dew_admins'::regclass
    ) THEN
        ALTER TABLE public.dew_admins ADD CONSTRAINT dew_admins_role_check
            CHECK (role IN ('admin', 'moderator', 'support', 'content_manager'));
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dew_admins_session_version_check' AND conrelid = 'public.dew_admins'::regclass
    ) THEN
        ALTER TABLE public.dew_admins ADD CONSTRAINT dew_admins_session_version_check CHECK (session_version > 0);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_dew_admins_role_active ON public.dew_admins(role, is_active);

ALTER TABLE public.dew_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dew_cosmetics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dew_cosmetic_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dew_cosmetic_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dew_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view manifest" ON public.dew_manifest;
DROP POLICY IF EXISTS "Manifest is service-only" ON public.dew_manifest;
CREATE POLICY "Manifest is service-only" ON public.dew_manifest FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public can view player cosmetics" ON public.dew_cosmetics;
DROP POLICY IF EXISTS "Cosmetics are service-only" ON public.dew_cosmetics;
CREATE POLICY "Cosmetics are service-only" ON public.dew_cosmetics FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public can view assets" ON public.dew_cosmetic_assets;
DROP POLICY IF EXISTS "Cosmetic assets are service-only" ON public.dew_cosmetic_assets;
CREATE POLICY "Cosmetic assets are service-only" ON public.dew_cosmetic_assets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Cosmetic library is service-only" ON public.dew_cosmetic_library;
CREATE POLICY "Cosmetic library is service-only" ON public.dew_cosmetic_library FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin credentials are service-only" ON public.dew_admins;
CREATE POLICY "Admin credentials are service-only" ON public.dew_admins FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.dew_bootstrap_admin(p_email TEXT, p_password_hash TEXT, p_display_name TEXT DEFAULT NULL)
RETURNS public.dew_admins
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    created_admin public.dew_admins;
BEGIN
    PERFORM pg_advisory_xact_lock(741052801);
    IF EXISTS (SELECT 1 FROM public.dew_admins WHERE role = 'admin' AND is_active = true) THEN
        RAISE EXCEPTION 'An active administrator already exists.' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.dew_admins(email, password_hash, display_name, role, is_active)
    VALUES (lower(trim(p_email)), p_password_hash, p_display_name, 'admin', true)
    RETURNING * INTO created_admin;
    RETURN created_admin;
END;
$$;

REVOKE ALL ON FUNCTION public.dew_bootstrap_admin(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_bootstrap_admin(TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.dew_is_cosmetic_asset_assigned(p_sha256 TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.dew_cosmetics
        WHERE skin @> jsonb_build_object('enabled', true, 'sha256', p_sha256)
           OR cape @> jsonb_build_object('enabled', true, 'sha256', p_sha256)
           OR (metadata->'capes') @> jsonb_build_array(jsonb_build_object('enabled', true, 'sha256', p_sha256))
           OR (metadata->'elytras') @> jsonb_build_array(jsonb_build_object('enabled', true, 'sha256', p_sha256))
    );
$$;

REVOKE ALL ON FUNCTION public.dew_is_cosmetic_asset_assigned(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_is_cosmetic_asset_assigned(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.dew_prevent_last_active_admin_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.role = 'admin' AND OLD.is_active THEN
            PERFORM pg_advisory_xact_lock(741052801);
            IF NOT EXISTS (SELECT 1 FROM public.dew_admins WHERE id <> OLD.id AND role = 'admin' AND is_active = true) THEN
                RAISE EXCEPTION 'At least one active administrator must remain.' USING ERRCODE = 'P0001';
            END IF;
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.role = 'admin' AND OLD.is_active AND (NEW.role <> 'admin' OR NEW.is_active = false) THEN
        PERFORM pg_advisory_xact_lock(741052801);
        IF NOT EXISTS (SELECT 1 FROM public.dew_admins WHERE id <> OLD.id AND role = 'admin' AND is_active = true) THEN
            RAISE EXCEPTION 'At least one active administrator must remain.' USING ERRCODE = 'P0001';
        END IF;
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role
        OR NEW.is_active IS DISTINCT FROM OLD.is_active
        OR NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
        NEW.session_version := OLD.session_version + 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dew_admins_keep_active_admin ON public.dew_admins;
CREATE TRIGGER dew_admins_keep_active_admin
    BEFORE UPDATE OR DELETE ON public.dew_admins
    FOR EACH ROW EXECUTE FUNCTION public.dew_prevent_last_active_admin_change();