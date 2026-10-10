-- =========================================================================
-- DewClient Central Management Server - Supabase PostgreSQL Database Schema
-- Run this script in your Supabase Project SQL Editor
-- =========================================================================

-- 1. Clients Table (Hardware installations and presence)
CREATE TABLE IF NOT EXISTS dew_clients (
    id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    client_version TEXT NOT NULL,
    os TEXT,
    os_version TEXT,
    architecture TEXT,
    hostname TEXT,
    status TEXT NOT NULL DEFAULT 'online',
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dew_clients_public_key ON dew_clients(public_key);
CREATE INDEX IF NOT EXISTS idx_dew_clients_last_seen ON dew_clients(last_seen_at);

-- 2. Accounts Table (Minecraft accounts logged into DewClient)
CREATE TABLE IF NOT EXISTS dew_accounts (
    uuid TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    type TEXT NOT NULL,
    avatar_url TEXT,
    skin_url TEXT,
    cape_url TEXT,
    client_id TEXT REFERENCES dew_clients(id) ON DELETE SET NULL,
    last_used_at TIMESTAMPTZ DEFAULT now(),
    registered_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dew_accounts_username ON dew_accounts(username);
CREATE INDEX IF NOT EXISTS idx_dew_accounts_last_used ON dew_accounts(last_used_at DESC);

-- Player presence is only written when a client explicitly opts in.
CREATE TABLE IF NOT EXISTS dew_player_presence (
    player_uuid TEXT PRIMARY KEY,
    username TEXT NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,16}$'),
    client_id TEXT NOT NULL REFERENCES dew_clients(id) ON DELETE CASCADE,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dew_player_presence_last_seen ON dew_player_presence(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_dew_player_presence_client ON dew_player_presence(client_id);

-- 3. Manifest Table (Remote launcher configuration: news, featured servers, announcements)
CREATE TABLE IF NOT EXISTS dew_manifest (
    id TEXT PRIMARY KEY DEFAULT 'primary',
    snapshot JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Player Cosmetics Table
CREATE TABLE IF NOT EXISTS dew_cosmetics (
    player_uuid TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    skin JSONB,
    cape JSONB,
    elytra JSONB,
    metadata JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE dew_cosmetics ADD COLUMN IF NOT EXISTS elytra JSONB;

-- 5. Admin Credentials Table
CREATE TABLE IF NOT EXISTS dew_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role = 'admin'),
    session_version BIGINT NOT NULL DEFAULT 1 CHECK (session_version > 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE dew_admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE dew_admins ADD COLUMN IF NOT EXISTS session_version BIGINT NOT NULL DEFAULT 1;
-- This build intentionally uses a single administrator tier. Normalize older
-- role values and enforce that policy consistently on fresh and upgraded DBs.
ALTER TABLE dew_admins DROP CONSTRAINT IF EXISTS dew_admins_role_check;
UPDATE dew_admins SET role = 'admin' WHERE role IS DISTINCT FROM 'admin';
ALTER TABLE dew_admins ALTER COLUMN role SET DEFAULT 'admin';
ALTER TABLE dew_admins ADD CONSTRAINT dew_admins_role_check CHECK (role = 'admin');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dew_admins_session_version_check' AND conrelid = 'public.dew_admins'::regclass
    ) THEN
        ALTER TABLE dew_admins ADD CONSTRAINT dew_admins_session_version_check CHECK (session_version > 0);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_dew_admins_role_active ON dew_admins(role, is_active);

-- Player-submitted support reports: no raw logs, auth tokens, account identity,
-- IP address, or hardware id are stored in this table.
CREATE TABLE IF NOT EXISTS public.dew_bug_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL CHECK (category IN ('launcher', 'game-launch', 'account', 'cosmetics', 'other')),
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 8 AND 120),
    description TEXT NOT NULL CHECK (char_length(description) BETWEEN 20 AND 5000),
    client_version TEXT NOT NULL CHECK (char_length(client_version) BETWEEN 1 AND 32),
    minecraft_version TEXT CHECK (minecraft_version IS NULL OR char_length(minecraft_version) <= 32),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved')),
    resolution_note TEXT CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dew_bug_reports_status_created ON public.dew_bug_reports(status, created_at DESC);

-- 6. Cosmetic Assets Binary Table
CREATE TABLE IF NOT EXISTS dew_cosmetic_assets (
    sha256 TEXT PRIMARY KEY,
    content_type TEXT NOT NULL DEFAULT 'image/png',
    byte_size INT NOT NULL,
    width INT,
    height INT,
    data_base64 TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Admin-only reusable cosmetic uploads. These are not exposed by the public
-- player cosmetics feed until assigned to a player.
CREATE TABLE IF NOT EXISTS dew_cosmetic_library (
    asset_id TEXT PRIMARY KEY REFERENCES dew_cosmetic_assets(sha256) ON DELETE CASCADE,
    sha256 TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('skin', 'cape', 'elytra')),
    content_type TEXT NOT NULL DEFAULT 'image/png',
    byte_size INT NOT NULL,
    width INT,
    height INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dew_cosmetic_library_kind ON dew_cosmetic_library(kind);

-- Row Level Security (RLS) Policies
-- Public API access is mediated by the server; direct Supabase rows stay private.
ALTER TABLE dew_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE dew_cosmetics ENABLE ROW LEVEL SECURITY;
ALTER TABLE dew_cosmetic_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE dew_cosmetic_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE dew_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE dew_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE dew_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE dew_player_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE dew_bug_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can view manifest" ON dew_manifest;
DROP POLICY IF EXISTS "Manifest is service-only" ON dew_manifest;
CREATE POLICY "Manifest is service-only" ON dew_manifest FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public can view player cosmetics" ON dew_cosmetics;
DROP POLICY IF EXISTS "Cosmetics are service-only" ON dew_cosmetics;
CREATE POLICY "Cosmetics are service-only" ON dew_cosmetics FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public can view assets" ON dew_cosmetic_assets;
DROP POLICY IF EXISTS "Cosmetic assets are service-only" ON dew_cosmetic_assets;
CREATE POLICY "Cosmetic assets are service-only" ON dew_cosmetic_assets FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Cosmetic library is service-only" ON dew_cosmetic_library;
CREATE POLICY "Cosmetic library is service-only" ON dew_cosmetic_library FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin credentials are service-only" ON dew_admins;
CREATE POLICY "Admin credentials are service-only" ON dew_admins FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service can manage all" ON dew_clients;
DROP POLICY IF EXISTS "Service can manage accounts" ON dew_accounts;
CREATE POLICY "Service can manage all" ON dew_clients FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service can manage accounts" ON dew_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Player presence is service-only" ON dew_player_presence;
CREATE POLICY "Player presence is service-only" ON dew_player_presence FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.dew_bug_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dew_bug_reports TO service_role;
DROP POLICY IF EXISTS "Bug reports are service-only" ON public.dew_bug_reports;
CREATE POLICY "Bug reports are service-only" ON public.dew_bug_reports FOR ALL TO service_role USING (true) WITH CHECK (true);

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
           OR elytra @> jsonb_build_object('enabled', true, 'sha256', p_sha256)
           OR (metadata->'skins') @> jsonb_build_array(jsonb_build_object('enabled', true, 'sha256', p_sha256))
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

    IF OLD.role = 'admin' AND OLD.is_active
        AND (NEW.role <> 'admin' OR NEW.is_active = false) THEN
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

CREATE OR REPLACE FUNCTION public.dew_check_signup_availability(p_username TEXT DEFAULT NULL, p_email TEXT DEFAULT NULL)
RETURNS TABLE(username_available BOOLEAN, email_available BOOLEAN)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
    SELECT
        p_username IS NULL OR NOT EXISTS (
            SELECT 1 FROM auth.users AS auth_user
            WHERE lower(btrim(auth_user.raw_user_meta_data ->> 'username')) = lower(btrim(p_username))
        ),
        p_email IS NULL OR NOT EXISTS (
            SELECT 1 FROM auth.users AS auth_user
            WHERE lower(btrim(auth_user.email)) = lower(btrim(p_email))
        );
$$;

REVOKE ALL ON FUNCTION public.dew_check_signup_availability(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_check_signup_availability(TEXT, TEXT) TO service_role;

CREATE TABLE IF NOT EXISTS public.dew_minecraft_identities (
    dew_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    player_uuid TEXT NOT NULL UNIQUE CHECK (player_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    minecraft_username TEXT NOT NULL CHECK (minecraft_username ~ '^[A-Za-z0-9_]{3,16}$'),
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dew_cosmetics_client_authorizations (
    dew_user_id UUID NOT NULL REFERENCES public.dew_minecraft_identities(dew_user_id) ON DELETE CASCADE,
    player_uuid TEXT NOT NULL REFERENCES public.dew_minecraft_identities(player_uuid) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES public.dew_clients(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (dew_user_id, player_uuid, client_id)
);

CREATE TABLE IF NOT EXISTS public.dew_cosmetics_publish_nonces (
    client_id TEXT NOT NULL REFERENCES public.dew_clients(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_dew_cosmetics_publish_nonces_created_at
    ON public.dew_cosmetics_publish_nonces(created_at);

ALTER TABLE public.dew_minecraft_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dew_cosmetics_client_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dew_cosmetics_publish_nonces ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.dew_link_minecraft_identity(
    p_dew_user_id UUID,
    p_player_uuid TEXT,
    p_minecraft_username TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
    IF p_player_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR p_minecraft_username !~ '^[A-Za-z0-9_]{3,16}$' THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.dew_minecraft_identities(dew_user_id, player_uuid, minecraft_username)
    VALUES (p_dew_user_id, lower(p_player_uuid), p_minecraft_username)
    ON CONFLICT DO NOTHING;

    UPDATE public.dew_minecraft_identities
    SET minecraft_username = p_minecraft_username, updated_at = now()
    WHERE dew_user_id = p_dew_user_id AND player_uuid = lower(p_player_uuid);

    RETURN EXISTS (
        SELECT 1 FROM public.dew_minecraft_identities
        WHERE dew_user_id = p_dew_user_id AND player_uuid = lower(p_player_uuid)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.dew_authorize_cosmetics_publish(
    p_dew_user_id UUID,
    p_player_uuid TEXT,
    p_minecraft_username TEXT,
    p_client_id TEXT,
    p_public_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
    IF p_player_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR p_minecraft_username !~ '^[A-Za-z0-9_]{3,16}$'
        OR p_public_key !~* '^[0-9a-f]{64}$' THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.dew_minecraft_identities(dew_user_id, player_uuid, minecraft_username)
    VALUES (p_dew_user_id, lower(p_player_uuid), p_minecraft_username)
    ON CONFLICT DO NOTHING;

    UPDATE public.dew_minecraft_identities
    SET minecraft_username = p_minecraft_username, updated_at = now()
    WHERE dew_user_id = p_dew_user_id AND player_uuid = lower(p_player_uuid);

    IF NOT EXISTS (
        SELECT 1 FROM public.dew_minecraft_identities
        WHERE dew_user_id = p_dew_user_id AND player_uuid = lower(p_player_uuid)
    ) THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.dew_cosmetics_client_authorizations(dew_user_id, player_uuid, client_id, public_key)
    VALUES (p_dew_user_id, lower(p_player_uuid), p_client_id, lower(p_public_key))
    ON CONFLICT (dew_user_id, player_uuid, client_id) DO NOTHING;

    RETURN EXISTS (
        SELECT 1 FROM public.dew_cosmetics_client_authorizations
        WHERE dew_user_id = p_dew_user_id
            AND player_uuid = lower(p_player_uuid)
            AND client_id = p_client_id
            AND public_key = lower(p_public_key)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.dew_claim_cosmetics_publish_request(p_client_id TEXT, p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    DELETE FROM public.dew_cosmetics_publish_nonces WHERE created_at < now() - interval '1 day';
    INSERT INTO public.dew_cosmetics_publish_nonces(client_id, request_id)
    VALUES (p_client_id, p_request_id)
    ON CONFLICT (client_id, request_id) DO NOTHING;
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.dew_authorize_cosmetics_publish(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_authorize_cosmetics_publish(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.dew_link_minecraft_identity(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_link_minecraft_identity(UUID, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.dew_claim_cosmetics_publish_request(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_claim_cosmetics_publish_request(TEXT, UUID) TO service_role;

-- Migration 009: free cape claims and verified Discord linking.
-- Free capes are opt-in catalog items and can only be claimed by a verified
-- Dew account/Minecraft identity through the Discord interaction endpoint.
ALTER TABLE public.dew_cosmetic_library
    ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dew_cosmetic_library_free_capes_only'
          AND conrelid = 'public.dew_cosmetic_library'::regclass
    ) THEN
        ALTER TABLE public.dew_cosmetic_library
            ADD CONSTRAINT dew_cosmetic_library_free_capes_only CHECK (NOT is_free OR kind = 'cape');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.dew_discord_account_links (
    discord_user_id TEXT PRIMARY KEY CHECK (discord_user_id ~ '^[0-9]{17,20}$'),
    player_uuid TEXT NOT NULL UNIQUE CHECK (player_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    minecraft_username TEXT NOT NULL CHECK (minecraft_username ~ '^[A-Za-z0-9_]{3,16}$'),
    guild_id TEXT NOT NULL CHECK (guild_id ~ '^[0-9]{17,20}$'),
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dew_free_cosmetic_claim_codes (
    code_hash TEXT PRIMARY KEY CHECK (code_hash ~ '^[a-f0-9]{64}$'),
    asset_id TEXT NOT NULL REFERENCES public.dew_cosmetic_library(asset_id) ON DELETE CASCADE,
    player_uuid TEXT NOT NULL CHECK (player_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    minecraft_username TEXT NOT NULL CHECK (minecraft_username ~ '^[A-Za-z0-9_]{3,16}$'),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    consumed_by_discord_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dew_free_cosmetic_claim_codes_expiry
    ON public.dew_free_cosmetic_claim_codes(expires_at);

CREATE TABLE IF NOT EXISTS public.dew_free_cosmetic_claims (
    asset_id TEXT NOT NULL REFERENCES public.dew_cosmetic_library(asset_id) ON DELETE CASCADE,
    player_uuid TEXT NOT NULL CHECK (player_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    discord_user_id TEXT NOT NULL REFERENCES public.dew_discord_account_links(discord_user_id) ON DELETE CASCADE,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, player_uuid)
);
CREATE INDEX IF NOT EXISTS idx_dew_free_cosmetic_claims_player
    ON public.dew_free_cosmetic_claims(player_uuid, claimed_at DESC);

ALTER TABLE public.dew_discord_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dew_free_cosmetic_claim_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dew_free_cosmetic_claims ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.dew_consume_free_cosmetic_code(
    p_code_hash TEXT,
    p_discord_user_id TEXT,
    p_guild_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_code public.dew_free_cosmetic_claim_codes%ROWTYPE;
    v_cosmetic public.dew_cosmetic_library%ROWTYPE;
    v_linked_uuid TEXT;
    v_linked_discord TEXT;
    v_cosmetic_json JSONB;
    v_capes JSONB;
    v_metadata JSONB;
BEGIN
    IF p_code_hash !~ '^[a-f0-9]{64}$'
       OR p_discord_user_id !~ '^[0-9]{17,20}$'
       OR p_guild_id !~ '^[0-9]{17,20}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    SELECT * INTO v_code FROM public.dew_free_cosmetic_claim_codes
    WHERE code_hash = p_code_hash FOR UPDATE;
    IF NOT FOUND OR v_code.used_at IS NOT NULL OR v_code.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired_or_invalid');
    END IF;

    SELECT * INTO v_cosmetic FROM public.dew_cosmetic_library
    WHERE asset_id = v_code.asset_id AND is_free = TRUE AND kind = 'cape';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_available');
    END IF;

    SELECT player_uuid INTO v_linked_uuid FROM public.dew_discord_account_links
    WHERE discord_user_id = p_discord_user_id FOR UPDATE;
    IF v_linked_uuid IS NOT NULL AND lower(v_linked_uuid) <> lower(v_code.player_uuid) THEN
        RETURN jsonb_build_object('status', 'discord_already_linked');
    END IF;
    SELECT discord_user_id INTO v_linked_discord FROM public.dew_discord_account_links
    WHERE lower(player_uuid) = lower(v_code.player_uuid) FOR UPDATE;
    IF v_linked_discord IS NOT NULL AND v_linked_discord <> p_discord_user_id THEN
        RETURN jsonb_build_object('status', 'player_already_linked');
    END IF;

    INSERT INTO public.dew_discord_account_links(discord_user_id, player_uuid, minecraft_username, guild_id)
    VALUES (p_discord_user_id, lower(v_code.player_uuid), v_code.minecraft_username, p_guild_id)
    ON CONFLICT (discord_user_id) DO UPDATE
       SET minecraft_username = EXCLUDED.minecraft_username,
           guild_id = EXCLUDED.guild_id,
           updated_at = now()
       WHERE lower(public.dew_discord_account_links.player_uuid) = lower(EXCLUDED.player_uuid);

    IF NOT EXISTS (
        SELECT 1 FROM public.dew_discord_account_links
        WHERE discord_user_id = p_discord_user_id AND lower(player_uuid) = lower(v_code.player_uuid)
    ) THEN
        RETURN jsonb_build_object('status', 'link_conflict');
    END IF;

    INSERT INTO public.dew_free_cosmetic_claims(asset_id, player_uuid, discord_user_id)
    VALUES (v_code.asset_id, lower(v_code.player_uuid), p_discord_user_id)
    ON CONFLICT (asset_id, player_uuid) DO NOTHING;

    v_cosmetic_json := jsonb_build_object(
        'assetId', v_cosmetic.asset_id,
        'sha256', v_cosmetic.sha256,
        'name', v_cosmetic.name,
        'contentType', v_cosmetic.content_type,
        'byteSize', v_cosmetic.byte_size,
        'width', v_cosmetic.width,
        'height', v_cosmetic.height,
        'enabled', TRUE,
        'updatedAt', now()
    );
    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_capes
    FROM (
        SELECT DISTINCT ON (all_items.item->>'assetId') all_items.item
        FROM (
            SELECT cape_item.item FROM public.dew_cosmetics d
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.metadata->'capes', '[]'::jsonb)) AS cape_item(item)
            WHERE lower(d.player_uuid) = lower(v_code.player_uuid)
            UNION ALL SELECT v_cosmetic_json
        ) AS all_items(item)
        ORDER BY all_items.item->>'assetId'
    ) deduped;

    SELECT COALESCE(metadata, '{}'::jsonb) INTO v_metadata
    FROM public.dew_cosmetics WHERE lower(player_uuid) = lower(v_code.player_uuid);
    v_metadata := COALESCE(v_metadata, '{}'::jsonb) || jsonb_build_object(
        'capes', v_capes,
        'activeAdminCosmetics', COALESCE(v_metadata->'activeAdminCosmetics', '{}'::jsonb)
    );

    INSERT INTO public.dew_cosmetics(player_uuid, username, version, cape, metadata, updated_at)
    VALUES (lower(v_code.player_uuid), v_code.minecraft_username, 1, v_cosmetic_json, v_metadata, now())
    ON CONFLICT (player_uuid) DO UPDATE
       SET username = EXCLUDED.username,
           cape = COALESCE(public.dew_cosmetics.cape, EXCLUDED.cape),
           metadata = EXCLUDED.metadata,
           version = public.dew_cosmetics.version + 1,
           updated_at = now();

    UPDATE public.dew_free_cosmetic_claim_codes
    SET used_at = now(), consumed_by_discord_id = p_discord_user_id
    WHERE code_hash = p_code_hash;

    RETURN jsonb_build_object('status', 'claimed', 'assetId', v_code.asset_id, 'playerUuid', lower(v_code.player_uuid));
END;
$$;

REVOKE ALL ON FUNCTION public.dew_consume_free_cosmetic_code(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_consume_free_cosmetic_code(TEXT, TEXT, TEXT) TO service_role;

-- Migration 010: persistent Discord links and one-click free cape claims.

-- Link each verified Minecraft identity to one Discord user once. Later free
-- cape claims use the saved link and are completed directly from the launcher.
CREATE TABLE IF NOT EXISTS public.dew_discord_account_link_codes (
    code_hash TEXT PRIMARY KEY CHECK (code_hash ~ '^[a-f0-9]{64}$'),
    player_uuid TEXT NOT NULL CHECK (player_uuid ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
    minecraft_username TEXT NOT NULL CHECK (minecraft_username ~ '^[A-Za-z0-9_]{3,16}$'),
    initial_asset_id TEXT REFERENCES public.dew_cosmetic_library(asset_id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    consumed_by_discord_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dew_discord_link_codes_player_expiry
    ON public.dew_discord_account_link_codes(player_uuid, expires_at DESC);
ALTER TABLE public.dew_discord_account_link_codes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.dew_claim_free_cosmetic_for_linked_player(
    p_asset_id TEXT,
    p_player_uuid TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_cosmetic public.dew_cosmetic_library%ROWTYPE;
    v_discord_user_id TEXT;
    v_username TEXT;
    v_cosmetic_json JSONB;
    v_capes JSONB;
    v_metadata JSONB;
    v_rows INTEGER;
BEGIN
    IF p_asset_id !~* '^[a-f0-9]{64}$'
       OR p_player_uuid !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('player:' || lower(p_player_uuid), 0));
    SELECT discord_user_id, minecraft_username INTO v_discord_user_id, v_username
    FROM public.dew_discord_account_links
    WHERE lower(player_uuid) = lower(p_player_uuid);
    IF v_discord_user_id IS NULL THEN
        RETURN jsonb_build_object('status', 'link_required');
    END IF;

    SELECT * INTO v_cosmetic FROM public.dew_cosmetic_library
    WHERE asset_id = lower(p_asset_id) AND is_free = TRUE AND kind = 'cape';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_available');
    END IF;

    INSERT INTO public.dew_free_cosmetic_claims(asset_id, player_uuid, discord_user_id)
    VALUES (v_cosmetic.asset_id, lower(p_player_uuid), v_discord_user_id)
    ON CONFLICT (asset_id, player_uuid) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN jsonb_build_object('status', 'already_claimed', 'assetId', v_cosmetic.asset_id);
    END IF;

    v_cosmetic_json := jsonb_build_object(
        'assetId', v_cosmetic.asset_id,
        'sha256', v_cosmetic.sha256,
        'name', v_cosmetic.name,
        'contentType', v_cosmetic.content_type,
        'byteSize', v_cosmetic.byte_size,
        'width', v_cosmetic.width,
        'height', v_cosmetic.height,
        'enabled', TRUE,
        'updatedAt', now()
    );
    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_capes
    FROM (
        SELECT DISTINCT ON (all_items.item->>'assetId') all_items.item
        FROM (
            SELECT cape_item.item FROM public.dew_cosmetics d
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.metadata->'capes', '[]'::jsonb)) AS cape_item(item)
            WHERE lower(d.player_uuid) = lower(p_player_uuid)
            UNION ALL SELECT v_cosmetic_json
        ) AS all_items(item)
        ORDER BY all_items.item->>'assetId'
    ) deduped;

    SELECT COALESCE(metadata, '{}'::jsonb) INTO v_metadata
    FROM public.dew_cosmetics WHERE lower(player_uuid) = lower(p_player_uuid);
    v_metadata := COALESCE(v_metadata, '{}'::jsonb) || jsonb_build_object(
        'capes', v_capes,
        'activeAdminCosmetics', COALESCE(v_metadata->'activeAdminCosmetics', '{}'::jsonb)
    );

    INSERT INTO public.dew_cosmetics(player_uuid, username, version, cape, metadata, updated_at)
    VALUES (lower(p_player_uuid), v_username, 1, v_cosmetic_json, v_metadata, now())
    ON CONFLICT (player_uuid) DO UPDATE
       SET cape = COALESCE(public.dew_cosmetics.cape, EXCLUDED.cape),
           metadata = EXCLUDED.metadata,
           version = public.dew_cosmetics.version + 1,
           updated_at = now();

    RETURN jsonb_build_object('status', 'claimed', 'assetId', v_cosmetic.asset_id, 'playerUuid', lower(p_player_uuid));
END;
$$;

CREATE OR REPLACE FUNCTION public.dew_consume_discord_account_link_code(
    p_code_hash TEXT,
    p_discord_user_id TEXT,
    p_guild_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_code public.dew_discord_account_link_codes%ROWTYPE;
    v_linked_uuid TEXT;
    v_linked_discord TEXT;
    v_claim_result JSONB;
BEGIN
    IF p_code_hash !~ '^[a-f0-9]{64}$'
       OR p_discord_user_id !~ '^[0-9]{17,20}$'
       OR p_guild_id !~ '^[0-9]{17,20}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    SELECT * INTO v_code FROM public.dew_discord_account_link_codes
    WHERE code_hash = p_code_hash FOR UPDATE;
    IF NOT FOUND OR v_code.used_at IS NOT NULL OR v_code.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired_or_invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('discord:' || p_discord_user_id, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('player:' || lower(v_code.player_uuid), 0));
    SELECT player_uuid INTO v_linked_uuid FROM public.dew_discord_account_links
    WHERE discord_user_id = p_discord_user_id FOR UPDATE;
    IF v_linked_uuid IS NOT NULL AND lower(v_linked_uuid) <> lower(v_code.player_uuid) THEN
        RETURN jsonb_build_object('status', 'discord_already_linked');
    END IF;
    SELECT discord_user_id INTO v_linked_discord FROM public.dew_discord_account_links
    WHERE lower(player_uuid) = lower(v_code.player_uuid) FOR UPDATE;
    IF v_linked_discord IS NOT NULL AND v_linked_discord <> p_discord_user_id THEN
        RETURN jsonb_build_object('status', 'player_already_linked');
    END IF;

    INSERT INTO public.dew_discord_account_links(discord_user_id, player_uuid, minecraft_username, guild_id)
    VALUES (p_discord_user_id, lower(v_code.player_uuid), v_code.minecraft_username, p_guild_id)
    ON CONFLICT (discord_user_id) DO UPDATE
       SET minecraft_username = EXCLUDED.minecraft_username,
           guild_id = EXCLUDED.guild_id,
           updated_at = now()
       WHERE lower(public.dew_discord_account_links.player_uuid) = lower(EXCLUDED.player_uuid);

    IF NOT EXISTS (
        SELECT 1 FROM public.dew_discord_account_links
        WHERE discord_user_id = p_discord_user_id AND lower(player_uuid) = lower(v_code.player_uuid)
    ) THEN
        RETURN jsonb_build_object('status', 'link_conflict');
    END IF;

    UPDATE public.dew_discord_account_link_codes
    SET used_at = now(), consumed_by_discord_id = p_discord_user_id
    WHERE code_hash = p_code_hash;

    IF v_code.initial_asset_id IS NOT NULL THEN
        v_claim_result := public.dew_claim_free_cosmetic_for_linked_player(v_code.initial_asset_id, v_code.player_uuid);
        IF v_claim_result->>'status' = 'claimed' THEN
            RETURN jsonb_build_object('status', 'linked_and_claimed', 'assetId', v_code.initial_asset_id, 'playerUuid', lower(v_code.player_uuid));
        END IF;
        RETURN jsonb_build_object('status', 'linked', 'claimStatus', v_claim_result->>'status', 'playerUuid', lower(v_code.player_uuid));
    END IF;

    RETURN jsonb_build_object('status', 'linked', 'playerUuid', lower(v_code.player_uuid));
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'link_conflict');
END;
$$;

REVOKE ALL ON FUNCTION public.dew_claim_free_cosmetic_for_linked_player(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dew_consume_discord_account_link_code(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_claim_free_cosmetic_for_linked_player(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dew_consume_discord_account_link_code(TEXT, TEXT, TEXT) TO service_role;


-- Migration 011: remove obsolete allowlist trigger from Supabase Auth signup
-- An old dashboard-era auth.users trigger allowed only a single hard-coded
-- administrator email to sign in. It broke normal Dew account registration.
-- Staff access remains governed separately by dew_admins and the admin API.
DROP TRIGGER IF EXISTS ensure_admin_only ON auth.users;
DROP FUNCTION IF EXISTS public.check_admin_email();

-- 012_discord_accounts_and_names.sql
-- First-party Discord identities with a server-enforced one-month name-change cooldown.
-- Minecraft offline UUIDs are derived from the profile name. Keep the account
-- identity and cosmetic-assignment references valid when that UUID changes.
ALTER TABLE public.dew_account_identities
    DROP CONSTRAINT IF EXISTS dew_account_identities_account_uuid_fkey;
ALTER TABLE public.dew_account_identities
    ADD CONSTRAINT dew_account_identities_account_uuid_fkey
    FOREIGN KEY (account_uuid) REFERENCES public.dew_accounts(uuid)
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE public.dew_cosmetic_assignments
    DROP CONSTRAINT IF EXISTS dew_cosmetic_assignments_account_uuid_fkey;
ALTER TABLE public.dew_cosmetic_assignments
    ADD CONSTRAINT dew_cosmetic_assignments_account_uuid_fkey
    FOREIGN KEY (account_uuid) REFERENCES public.dew_accounts(uuid)
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS public.dew_discord_accounts (
    discord_user_id TEXT PRIMARY KEY CHECK (discord_user_id ~ '^[0-9]{17,20}$'),
    player_uuid TEXT NOT NULL UNIQUE CHECK (player_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    username TEXT NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,16}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_username_change_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dew_discord_accounts_username_ci
    ON public.dew_discord_accounts(lower(username));
ALTER TABLE public.dew_discord_accounts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.dew_create_discord_account(
    p_discord_user_id TEXT,
    p_player_uuid TEXT,
    p_username TEXT,
    p_guild_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_account public.dew_discord_accounts%ROWTYPE;
    v_dew_account_id UUID := gen_random_uuid();
BEGIN
    IF p_discord_user_id !~ '^[0-9]{17,20}$'
       OR p_player_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR p_username !~ '^[A-Za-z0-9_]{3,16}$'
       OR p_guild_id !~ '^[0-9]{17,20}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('discord-account:' || p_discord_user_id, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('minecraft-name:' || lower(p_username), 0));
    SELECT * INTO v_account FROM public.dew_discord_accounts
      WHERE discord_user_id = p_discord_user_id FOR UPDATE;
    IF FOUND THEN
        RETURN jsonb_build_object('status', 'exists', 'account', to_jsonb(v_account));
    END IF;
    IF EXISTS (SELECT 1 FROM public.dew_accounts WHERE lower(username) = lower(p_username))
       OR EXISTS (SELECT 1 FROM public.dew_discord_accounts WHERE lower(username) = lower(p_username)) THEN
        RETURN jsonb_build_object('status', 'unavailable');
    END IF;

    INSERT INTO public.dew_discord_accounts(discord_user_id, player_uuid, username, last_username_change_at)
    VALUES (p_discord_user_id, lower(p_player_uuid), p_username, now())
    RETURNING * INTO v_account;

    INSERT INTO public.dew_accounts(
      uuid, username, type, account_type, dew_account_id, username_normalized,
      minecraft_uuid, minecraft_username, avatar_url, last_used_at, updated_at
    ) VALUES (
      lower(p_player_uuid), p_username, 'offline', 'offline', v_dew_account_id, lower(p_username),
      lower(p_player_uuid)::uuid, p_username, 'https://mc-heads.net/avatar/' || p_username || '/64', now(), now()
    );

    INSERT INTO public.dew_account_identities(
      account_uuid, dew_account_id, identity_type, external_uuid, username, is_primary
    ) VALUES (
      lower(p_player_uuid), v_dew_account_id, 'offline_minecraft', lower(p_player_uuid)::uuid, p_username, TRUE
    );

    INSERT INTO public.dew_discord_account_links(discord_user_id, player_uuid, minecraft_username, guild_id)
    VALUES (p_discord_user_id, lower(p_player_uuid), p_username, p_guild_id)
    ON CONFLICT (discord_user_id) DO UPDATE SET
      minecraft_username = EXCLUDED.minecraft_username,
      guild_id = EXCLUDED.guild_id,
      updated_at = now()
    WHERE lower(public.dew_discord_account_links.player_uuid) = lower(EXCLUDED.player_uuid);

    RETURN jsonb_build_object('status', 'created', 'account', to_jsonb(v_account));
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'unavailable');
END;
$$;

CREATE OR REPLACE FUNCTION public.dew_change_discord_username(
    p_discord_user_id TEXT,
    p_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_account public.dew_discord_accounts%ROWTYPE;
    v_next_change TIMESTAMPTZ;
    v_hash TEXT;
    v_new_uuid TEXT;
BEGIN
    IF p_discord_user_id !~ '^[0-9]{17,20}$' OR p_username !~ '^[A-Za-z0-9_]{3,16}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('discord-account:' || p_discord_user_id, 0));
    SELECT * INTO v_account FROM public.dew_discord_accounts
      WHERE discord_user_id = p_discord_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'missing'); END IF;
    IF v_account.username = p_username THEN
        RETURN jsonb_build_object('status', 'unchanged', 'account', to_jsonb(v_account));
    END IF;
    v_next_change := v_account.last_username_change_at + interval '1 month';
    IF now() < v_next_change THEN
        RETURN jsonb_build_object('status', 'cooldown', 'availableAt', v_next_change);
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('minecraft-name:' || lower(p_username), 0));
    IF EXISTS (SELECT 1 FROM public.dew_accounts WHERE lower(username) = lower(p_username) AND lower(uuid) <> lower(v_account.player_uuid))
       OR EXISTS (SELECT 1 FROM public.dew_discord_accounts WHERE lower(username) = lower(p_username) AND discord_user_id <> p_discord_user_id) THEN
        RETURN jsonb_build_object('status', 'unavailable');
    END IF;
    v_hash := md5('OfflinePlayer:' || p_username);
    v_new_uuid := substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4) || '-3' || substr(v_hash, 14, 3)
      || '-' || translate(substr(v_hash, 17, 1), '0123456789abcdef', '89ab89ab89ab89ab') || substr(v_hash, 18, 3)
      || '-' || substr(v_hash, 21, 12);
    IF EXISTS (SELECT 1 FROM public.dew_accounts WHERE lower(uuid) = lower(v_new_uuid) AND lower(uuid) <> lower(v_account.player_uuid)) THEN
        RETURN jsonb_build_object('status', 'unavailable');
    END IF;
    DELETE FROM public.dew_discord_account_link_codes WHERE lower(player_uuid) = lower(v_account.player_uuid) AND used_at IS NULL;
    DELETE FROM public.dew_free_cosmetic_claim_codes
      WHERE lower(player_uuid) = lower(v_account.player_uuid) AND used_at IS NULL;
    UPDATE public.dew_free_cosmetic_claims SET player_uuid = lower(v_new_uuid)
      WHERE lower(player_uuid) = lower(v_account.player_uuid);
    UPDATE public.dew_cosmetics SET player_uuid = lower(v_new_uuid)
      WHERE lower(player_uuid) = lower(v_account.player_uuid);
    UPDATE public.dew_discord_account_links SET player_uuid = lower(v_new_uuid)
      WHERE discord_user_id = p_discord_user_id;
    UPDATE public.dew_player_presence SET player_uuid = lower(v_new_uuid)
      WHERE lower(player_uuid) = lower(v_account.player_uuid);
    UPDATE public.dew_account_identities SET external_uuid = lower(v_new_uuid)::uuid,
      username = p_username, updated_at = now()
      WHERE account_uuid = lower(v_account.player_uuid)
        AND external_uuid = lower(v_account.player_uuid)::uuid;
    UPDATE public.dew_accounts SET uuid = lower(v_new_uuid), minecraft_uuid = lower(v_new_uuid)::uuid,
      username_normalized = lower(p_username), minecraft_username = p_username
      WHERE lower(uuid) = lower(v_account.player_uuid);
    UPDATE public.dew_discord_accounts SET username = p_username, last_username_change_at = now(), updated_at = now()
      , player_uuid = lower(v_new_uuid) WHERE discord_user_id = p_discord_user_id RETURNING * INTO v_account;
    UPDATE public.dew_accounts SET username = p_username,
      avatar_url = 'https://mc-heads.net/avatar/' || p_username || '/64', updated_at = now()
      WHERE lower(uuid) = lower(v_new_uuid);
    UPDATE public.dew_discord_account_links SET minecraft_username = p_username, updated_at = now()
      WHERE discord_user_id = p_discord_user_id;
    UPDATE public.dew_cosmetics SET username = p_username, updated_at = now()
      WHERE lower(player_uuid) = lower(v_new_uuid);
    RETURN jsonb_build_object('status', 'changed', 'account', to_jsonb(v_account), 'changedAt', now(), 'nextChangeAt', now() + interval '1 month');
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'unavailable');
END;
$$;

REVOKE ALL ON FUNCTION public.dew_create_discord_account(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dew_change_discord_username(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_create_discord_account(TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dew_change_discord_username(TEXT, TEXT) TO service_role;

-- 013_discord_link_display_names.sql
ALTER TABLE public.dew_discord_account_links
    ADD COLUMN IF NOT EXISTS discord_username TEXT,
    ADD COLUMN IF NOT EXISTS discord_display_name TEXT;
ALTER TABLE public.dew_discord_account_links
    DROP CONSTRAINT IF EXISTS dew_discord_account_links_discord_username_length_check,
    ADD CONSTRAINT dew_discord_account_links_discord_username_length_check
        CHECK (discord_username IS NULL OR char_length(discord_username) BETWEEN 1 AND 64),
    DROP CONSTRAINT IF EXISTS dew_discord_account_links_discord_display_name_length_check,
    ADD CONSTRAINT dew_discord_account_links_discord_display_name_length_check
        CHECK (discord_display_name IS NULL OR char_length(discord_display_name) BETWEEN 1 AND 80);
-- Keep Discord OAuth profiles independent from Microsoft profiles. A Discord
-- identity may separately verify multiple DewClient profiles through the
-- one-time guild flow; sign-in itself never creates that verification link.
BEGIN;

ALTER TABLE public.dew_free_cosmetic_claims
    DROP CONSTRAINT IF EXISTS dew_free_cosmetic_claims_discord_user_id_fkey;

ALTER TABLE public.dew_discord_account_links
    DROP CONSTRAINT IF EXISTS dew_discord_account_links_pkey;
ALTER TABLE public.dew_discord_account_links
    ADD CONSTRAINT dew_discord_account_links_pkey PRIMARY KEY (discord_user_id, player_uuid);

ALTER TABLE public.dew_free_cosmetic_claims
    ADD CONSTRAINT dew_free_cosmetic_claims_discord_profile_fkey
    FOREIGN KEY (discord_user_id, player_uuid)
    REFERENCES public.dew_discord_account_links(discord_user_id, player_uuid)
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.dew_consume_discord_account_link_code(
    p_code_hash TEXT,
    p_discord_user_id TEXT,
    p_guild_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_code public.dew_discord_account_link_codes%ROWTYPE;
    v_linked_discord TEXT;
    v_claim_result JSONB;
BEGIN
    IF p_code_hash !~ '^[a-f0-9]{64}$'
       OR p_discord_user_id !~ '^[0-9]{17,20}$'
       OR p_guild_id !~ '^[0-9]{17,20}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    SELECT * INTO v_code FROM public.dew_discord_account_link_codes
    WHERE code_hash = p_code_hash FOR UPDATE;
    IF NOT FOUND OR v_code.used_at IS NOT NULL OR v_code.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired_or_invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('discord:' || p_discord_user_id, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('player:' || lower(v_code.player_uuid), 0));
    SELECT discord_user_id INTO v_linked_discord
    FROM public.dew_discord_account_links
    WHERE lower(player_uuid) = lower(v_code.player_uuid) FOR UPDATE;
    IF v_linked_discord IS NOT NULL AND v_linked_discord <> p_discord_user_id THEN
        RETURN jsonb_build_object('status', 'player_already_linked');
    END IF;

    INSERT INTO public.dew_discord_account_links(
        discord_user_id, player_uuid, minecraft_username, guild_id
    ) VALUES (
        p_discord_user_id, lower(v_code.player_uuid), v_code.minecraft_username, p_guild_id
    )
    ON CONFLICT (discord_user_id, player_uuid) DO UPDATE
       SET minecraft_username = EXCLUDED.minecraft_username,
           guild_id = EXCLUDED.guild_id,
           updated_at = now();

    UPDATE public.dew_discord_account_link_codes
    SET used_at = now(), consumed_by_discord_id = p_discord_user_id
    WHERE code_hash = p_code_hash;

    IF v_code.initial_asset_id IS NOT NULL THEN
        v_claim_result := public.dew_claim_free_cosmetic_for_linked_player(v_code.initial_asset_id, v_code.player_uuid);
        IF v_claim_result->>'status' = 'claimed' THEN
            RETURN jsonb_build_object('status', 'linked_and_claimed', 'assetId', v_code.initial_asset_id, 'playerUuid', lower(v_code.player_uuid));
        END IF;
        RETURN jsonb_build_object('status', 'linked', 'claimStatus', v_claim_result->>'status', 'playerUuid', lower(v_code.player_uuid));
    END IF;

    RETURN jsonb_build_object('status', 'linked', 'playerUuid', lower(v_code.player_uuid));
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'player_already_linked');
END;
$$;

CREATE OR REPLACE FUNCTION public.dew_consume_free_cosmetic_code(
    p_code_hash TEXT,
    p_discord_user_id TEXT,
    p_guild_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_code public.dew_free_cosmetic_claim_codes%ROWTYPE;
    v_cosmetic public.dew_cosmetic_library%ROWTYPE;
    v_linked_discord TEXT;
    v_cosmetic_json JSONB;
    v_capes JSONB;
    v_metadata JSONB;
BEGIN
    IF p_code_hash !~ '^[a-f0-9]{64}$'
       OR p_discord_user_id !~ '^[0-9]{17,20}$'
       OR p_guild_id !~ '^[0-9]{17,20}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    SELECT * INTO v_code FROM public.dew_free_cosmetic_claim_codes
    WHERE code_hash = p_code_hash FOR UPDATE;
    IF NOT FOUND OR v_code.used_at IS NOT NULL OR v_code.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired_or_invalid');
    END IF;

    SELECT * INTO v_cosmetic FROM public.dew_cosmetic_library
    WHERE asset_id = v_code.asset_id AND is_free = TRUE AND kind = 'cape';
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_available'); END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('discord:' || p_discord_user_id, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('player:' || lower(v_code.player_uuid), 0));
    SELECT discord_user_id INTO v_linked_discord FROM public.dew_discord_account_links
    WHERE lower(player_uuid) = lower(v_code.player_uuid) FOR UPDATE;
    IF v_linked_discord IS NOT NULL AND v_linked_discord <> p_discord_user_id THEN
        RETURN jsonb_build_object('status', 'player_already_linked');
    END IF;

    INSERT INTO public.dew_discord_account_links(discord_user_id, player_uuid, minecraft_username, guild_id)
    VALUES (p_discord_user_id, lower(v_code.player_uuid), v_code.minecraft_username, p_guild_id)
    ON CONFLICT (discord_user_id, player_uuid) DO UPDATE
       SET minecraft_username = EXCLUDED.minecraft_username,
           guild_id = EXCLUDED.guild_id,
           updated_at = now();

    INSERT INTO public.dew_free_cosmetic_claims(asset_id, player_uuid, discord_user_id)
    VALUES (v_code.asset_id, lower(v_code.player_uuid), p_discord_user_id)
    ON CONFLICT (asset_id, player_uuid) DO NOTHING;

    v_cosmetic_json := jsonb_build_object(
        'assetId', v_cosmetic.asset_id, 'sha256', v_cosmetic.sha256, 'name', v_cosmetic.name,
        'contentType', v_cosmetic.content_type, 'byteSize', v_cosmetic.byte_size,
        'width', v_cosmetic.width, 'height', v_cosmetic.height, 'enabled', TRUE, 'updatedAt', now()
    );
    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_capes
    FROM (
        SELECT DISTINCT ON (all_items.item->>'assetId') all_items.item
        FROM (
            SELECT cape_item.item FROM public.dew_cosmetics d
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.metadata->'capes', '[]'::jsonb)) AS cape_item(item)
            WHERE lower(d.player_uuid) = lower(v_code.player_uuid)
            UNION ALL SELECT v_cosmetic_json
        ) AS all_items(item)
        ORDER BY all_items.item->>'assetId'
    ) deduped;

    SELECT COALESCE(metadata, '{}'::jsonb) INTO v_metadata
    FROM public.dew_cosmetics WHERE lower(player_uuid) = lower(v_code.player_uuid);
    v_metadata := COALESCE(v_metadata, '{}'::jsonb) || jsonb_build_object(
        'capes', v_capes, 'activeAdminCosmetics', COALESCE(v_metadata->'activeAdminCosmetics', '{}'::jsonb)
    );

    INSERT INTO public.dew_cosmetics(player_uuid, username, version, cape, metadata, updated_at)
    VALUES (lower(v_code.player_uuid), v_code.minecraft_username, 1, v_cosmetic_json, v_metadata, now())
    ON CONFLICT (player_uuid) DO UPDATE
       SET username = EXCLUDED.username,
           cape = COALESCE(public.dew_cosmetics.cape, EXCLUDED.cape),
           metadata = EXCLUDED.metadata,
           version = public.dew_cosmetics.version + 1,
           updated_at = now();

    UPDATE public.dew_free_cosmetic_claim_codes
    SET used_at = now(), consumed_by_discord_id = p_discord_user_id
    WHERE code_hash = p_code_hash;
    RETURN jsonb_build_object('status', 'claimed', 'assetId', v_code.asset_id, 'playerUuid', lower(v_code.player_uuid));
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'player_already_linked');
END;
$$;

-- Discord OAuth creates a separate profile, but does not prove the user joined
-- the DewClient guild. Only the one-time server interaction creates this link.
CREATE OR REPLACE FUNCTION public.dew_create_discord_account(
    p_discord_user_id TEXT,
    p_player_uuid TEXT,
    p_username TEXT,
    p_guild_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_account public.dew_discord_accounts%ROWTYPE;
    v_dew_account_id UUID := gen_random_uuid();
BEGIN
    IF p_discord_user_id !~ '^[0-9]{17,20}$'
       OR p_player_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR p_username !~ '^[A-Za-z0-9_]{3,16}$'
       OR p_guild_id !~ '^[0-9]{17,20}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('discord-account:' || p_discord_user_id, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('minecraft-name:' || lower(p_username), 0));
    SELECT * INTO v_account FROM public.dew_discord_accounts
    WHERE discord_user_id = p_discord_user_id FOR UPDATE;
    IF FOUND THEN RETURN jsonb_build_object('status', 'exists', 'account', to_jsonb(v_account)); END IF;
    IF EXISTS (SELECT 1 FROM public.dew_accounts WHERE lower(username) = lower(p_username))
       OR EXISTS (SELECT 1 FROM public.dew_discord_accounts WHERE lower(username) = lower(p_username)) THEN
        RETURN jsonb_build_object('status', 'unavailable');
    END IF;

    INSERT INTO public.dew_discord_accounts(discord_user_id, player_uuid, username, last_username_change_at)
    VALUES (p_discord_user_id, lower(p_player_uuid), p_username, now())
    RETURNING * INTO v_account;
    INSERT INTO public.dew_accounts(
      uuid, username, type, account_type, dew_account_id, username_normalized,
      minecraft_uuid, minecraft_username, avatar_url, last_used_at, updated_at
    ) VALUES (
      lower(p_player_uuid), p_username, 'offline', 'offline', v_dew_account_id, lower(p_username),
      lower(p_player_uuid)::uuid, p_username, 'https://mc-heads.net/avatar/' || p_username || '/64', now(), now()
    );
    INSERT INTO public.dew_account_identities(
      account_uuid, dew_account_id, identity_type, external_uuid, username, is_primary
    ) VALUES (
      lower(p_player_uuid), v_dew_account_id, 'offline_minecraft', lower(p_player_uuid)::uuid, p_username, TRUE
    );
    RETURN jsonb_build_object('status', 'created', 'account', to_jsonb(v_account));
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'unavailable');
END;
$$;

CREATE OR REPLACE FUNCTION public.dew_change_discord_username(
    p_discord_user_id TEXT,
    p_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_account public.dew_discord_accounts%ROWTYPE;
    v_old_uuid TEXT;
    v_next_change TIMESTAMPTZ;
    v_hash TEXT;
    v_new_uuid TEXT;
BEGIN
    IF p_discord_user_id !~ '^[0-9]{17,20}$' OR p_username !~ '^[A-Za-z0-9_]{3,16}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('discord-account:' || p_discord_user_id, 0));
    SELECT * INTO v_account FROM public.dew_discord_accounts
    WHERE discord_user_id = p_discord_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'missing'); END IF;
    IF v_account.username = p_username THEN RETURN jsonb_build_object('status', 'unchanged', 'account', to_jsonb(v_account)); END IF;
    v_old_uuid := lower(v_account.player_uuid);
    v_next_change := v_account.last_username_change_at + interval '1 month';
    IF now() < v_next_change THEN RETURN jsonb_build_object('status', 'cooldown', 'availableAt', v_next_change); END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('minecraft-name:' || lower(p_username), 0));
    IF EXISTS (SELECT 1 FROM public.dew_accounts WHERE lower(username) = lower(p_username) AND lower(uuid) <> v_old_uuid)
       OR EXISTS (SELECT 1 FROM public.dew_discord_accounts WHERE lower(username) = lower(p_username) AND discord_user_id <> p_discord_user_id) THEN
        RETURN jsonb_build_object('status', 'unavailable');
    END IF;

    v_hash := md5('OfflinePlayer:' || p_username);
    v_new_uuid := substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4) || '-3' || substr(v_hash, 14, 3)
      || '-' || translate(substr(v_hash, 17, 1), '0123456789abcdef', '89ab89ab89ab89ab') || substr(v_hash, 18, 3)
      || '-' || substr(v_hash, 21, 12);
    IF EXISTS (SELECT 1 FROM public.dew_accounts WHERE lower(uuid) = lower(v_new_uuid) AND lower(uuid) <> v_old_uuid) THEN
        RETURN jsonb_build_object('status', 'unavailable');
    END IF;

    DELETE FROM public.dew_discord_account_link_codes WHERE lower(player_uuid) = v_old_uuid AND used_at IS NULL;
    DELETE FROM public.dew_free_cosmetic_claim_codes WHERE lower(player_uuid) = v_old_uuid AND used_at IS NULL;
    UPDATE public.dew_discord_account_links SET player_uuid = lower(v_new_uuid), minecraft_username = p_username, updated_at = now()
      WHERE discord_user_id = p_discord_user_id AND lower(player_uuid) = v_old_uuid;
    UPDATE public.dew_free_cosmetic_claims SET player_uuid = lower(v_new_uuid) WHERE lower(player_uuid) = v_old_uuid;
    UPDATE public.dew_cosmetics SET player_uuid = lower(v_new_uuid) WHERE lower(player_uuid) = v_old_uuid;
    UPDATE public.dew_player_presence SET player_uuid = lower(v_new_uuid) WHERE lower(player_uuid) = v_old_uuid;
    UPDATE public.dew_account_identities SET external_uuid = lower(v_new_uuid)::uuid, username = p_username, updated_at = now()
      WHERE account_uuid = v_old_uuid AND external_uuid = v_old_uuid::uuid;
    UPDATE public.dew_accounts SET uuid = lower(v_new_uuid), minecraft_uuid = lower(v_new_uuid)::uuid,
      username_normalized = lower(p_username), minecraft_username = p_username
      WHERE lower(uuid) = v_old_uuid;
    UPDATE public.dew_discord_accounts SET username = p_username, last_username_change_at = now(), updated_at = now(),
      player_uuid = lower(v_new_uuid) WHERE discord_user_id = p_discord_user_id RETURNING * INTO v_account;
    UPDATE public.dew_accounts SET username = p_username, avatar_url = 'https://mc-heads.net/avatar/' || p_username || '/64', updated_at = now()
      WHERE lower(uuid) = lower(v_new_uuid);
    UPDATE public.dew_cosmetics SET username = p_username, updated_at = now() WHERE lower(player_uuid) = lower(v_new_uuid);
    RETURN jsonb_build_object('status', 'changed', 'account', to_jsonb(v_account), 'changedAt', now(), 'nextChangeAt', now() + interval '1 month');
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'unavailable');
END;
$$;

REVOKE ALL ON FUNCTION public.dew_consume_discord_account_link_code(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dew_consume_free_cosmetic_code(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dew_create_discord_account(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dew_change_discord_username(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_consume_discord_account_link_code(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dew_consume_free_cosmetic_code(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dew_create_discord_account(TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dew_change_discord_username(TEXT, TEXT) TO service_role;

COMMIT;


-- Migration 015: atomic cosmetic deletion and orphan cleanup.
-- Delete cosmetics through one database transaction, including orphaned binary
-- assets. The assignment guard sees every profile and the legacy assignment table.
BEGIN;

CREATE OR REPLACE FUNCTION public.dew_is_cosmetic_asset_assigned(p_sha256 TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_sha256 IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.dew_cosmetics d
      WHERE lower(COALESCE(d.skin->>'assetId', '')) = lower(p_sha256)
         OR lower(COALESCE(d.skin->>'sha256', '')) = lower(p_sha256)
         OR lower(COALESCE(d.cape->>'assetId', '')) = lower(p_sha256)
         OR lower(COALESCE(d.cape->>'sha256', '')) = lower(p_sha256)
         OR lower(COALESCE(d.elytra->>'assetId', '')) = lower(p_sha256)
         OR lower(COALESCE(d.elytra->>'sha256', '')) = lower(p_sha256)
         OR lower(COALESCE(d.metadata->'activeAdminCosmetics'->>'skin', '')) = lower(p_sha256)
         OR lower(COALESCE(d.metadata->'activeAdminCosmetics'->>'cape', '')) = lower(p_sha256)
         OR lower(COALESCE(d.metadata->'activeAdminCosmetics'->>'elytra', '')) = lower(p_sha256)
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(d.metadata->'skins') = 'array' THEN d.metadata->'skins' ELSE '[]'::jsonb END
           ) AS item(value)
           WHERE lower(COALESCE(item.value->>'assetId', '')) = lower(p_sha256)
              OR lower(COALESCE(item.value->>'sha256', '')) = lower(p_sha256)
         )
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(d.metadata->'capes') = 'array' THEN d.metadata->'capes' ELSE '[]'::jsonb END
           ) AS item(value)
           WHERE lower(COALESCE(item.value->>'assetId', '')) = lower(p_sha256)
              OR lower(COALESCE(item.value->>'sha256', '')) = lower(p_sha256)
         )
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(d.metadata->'elytras') = 'array' THEN d.metadata->'elytras' ELSE '[]'::jsonb END
           ) AS item(value)
           WHERE lower(COALESCE(item.value->>'assetId', '')) = lower(p_sha256)
              OR lower(COALESCE(item.value->>'sha256', '')) = lower(p_sha256)
         )
    )
    OR EXISTS (
      SELECT 1
      FROM public.dew_cosmetic_assignments a
      WHERE lower(a.cosmetic_id) = lower(p_sha256)
        AND a.enabled = TRUE
        AND (a.expires_at IS NULL OR a.expires_at > now())
    )
  );
$$;

REVOKE ALL ON FUNCTION public.dew_is_cosmetic_asset_assigned(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_is_cosmetic_asset_assigned(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.dew_delete_cosmetic_library_item(p_asset_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_item public.dew_cosmetic_library%ROWTYPE;
  v_player public.dew_cosmetics%ROWTYPE;
  v_metadata JSONB;
  v_active JSONB;
  v_admin_kinds JSONB;
  v_collection_key TEXT;
  v_list JSONB;
  v_filtered JSONB;
  v_direct JSONB;
  v_replacement JSONB;
  v_replacement_id TEXT;
  v_kind TEXT;
  v_direct_matches BOOLEAN;
  v_active_matches BOOLEAN;
  v_collection_changed BOOLEAN;
  v_touches_kind BOOLEAN;
  v_player_changed BOOLEAN;
  v_skin JSONB;
  v_cape JSONB;
  v_elytra JSONB;
  v_profiles_updated INTEGER := 0;
  v_assignments_deleted INTEGER := 0;
  v_asset_rows INTEGER := 0;
BEGIN
  IF p_asset_id IS NULL OR p_asset_id !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cosmetic-library:' || lower(p_asset_id), 0));
  SELECT * INTO v_item
  FROM public.dew_cosmetic_library
  WHERE lower(asset_id) = lower(p_asset_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Remove the texture from every player's current selection and assigned
  -- collection in the same transaction as the library and binary rows.
  FOR v_player IN SELECT * FROM public.dew_cosmetics FOR UPDATE LOOP
    v_metadata := COALESCE(v_player.metadata, '{}'::jsonb);
    IF jsonb_typeof(v_metadata) <> 'object' THEN v_metadata := '{}'::jsonb; END IF;
    v_active := CASE WHEN jsonb_typeof(v_metadata->'activeAdminCosmetics') = 'object'
      THEN v_metadata->'activeAdminCosmetics' ELSE '{}'::jsonb END;
    v_admin_kinds := CASE WHEN jsonb_typeof(v_metadata->'adminAssignedKinds') = 'array'
      THEN v_metadata->'adminAssignedKinds' ELSE '[]'::jsonb END;
    v_skin := v_player.skin;
    v_cape := v_player.cape;
    v_elytra := v_player.elytra;
    v_player_changed := FALSE;

    FOREACH v_kind IN ARRAY ARRAY['skin', 'cape', 'elytra'] LOOP
      v_collection_key := CASE v_kind WHEN 'skin' THEN 'skins' WHEN 'cape' THEN 'capes' ELSE 'elytras' END;
      v_direct := CASE v_kind WHEN 'skin' THEN v_player.skin WHEN 'cape' THEN v_player.cape ELSE v_player.elytra END;
      v_list := CASE WHEN jsonb_typeof(v_metadata->v_collection_key) = 'array'
        THEN v_metadata->v_collection_key ELSE '[]'::jsonb END;

      SELECT COALESCE(jsonb_agg(entry.value ORDER BY entry.ordinality), '[]'::jsonb)
        INTO v_filtered
      FROM jsonb_array_elements(v_list) WITH ORDINALITY AS entry(value, ordinality)
      WHERE lower(COALESCE(entry.value->>'assetId', '')) NOT IN (lower(v_item.asset_id), lower(v_item.sha256))
        AND lower(COALESCE(entry.value->>'sha256', '')) NOT IN (lower(v_item.asset_id), lower(v_item.sha256));

      v_direct_matches :=
        lower(COALESCE(v_direct->>'assetId', '')) IN (lower(v_item.asset_id), lower(v_item.sha256))
        OR lower(COALESCE(v_direct->>'sha256', '')) IN (lower(v_item.asset_id), lower(v_item.sha256));
      v_active_matches := lower(COALESCE(v_active->>v_kind, '')) IN (lower(v_item.asset_id), lower(v_item.sha256));
      v_collection_changed := v_filtered IS DISTINCT FROM v_list;
      v_touches_kind := v_direct_matches OR v_active_matches OR v_collection_changed;

      IF v_collection_changed THEN
        v_metadata := jsonb_set(v_metadata, ARRAY[v_collection_key], v_filtered, TRUE);
      END IF;
      IF v_direct_matches THEN
        IF v_kind = 'skin' THEN v_skin := v_filtered->0;
        ELSIF v_kind = 'cape' THEN v_cape := v_filtered->0;
        ELSE v_elytra := v_filtered->0;
        END IF;
      END IF;
      IF v_active_matches THEN
        IF v_direct_matches THEN
          v_replacement := v_filtered->0;
        ELSE
          v_replacement := COALESCE(v_direct, v_filtered->0);
        END IF;
        v_replacement_id := COALESCE(v_replacement->>'assetId', v_replacement->>'sha256');
        IF v_replacement_id IS NULL OR v_replacement_id = '' THEN
          v_active := v_active - v_kind;
        ELSE
          v_active := jsonb_set(v_active, ARRAY[v_kind], to_jsonb(v_replacement_id), TRUE);
        END IF;
      END IF;

      IF v_touches_kind
         AND jsonb_array_length(v_filtered) = 0
         AND (v_direct_matches OR v_direct IS NULL)
         AND v_admin_kinds ? v_kind THEN
        SELECT COALESCE(jsonb_agg(k.value), '[]'::jsonb) INTO v_admin_kinds
        FROM jsonb_array_elements_text(v_admin_kinds) AS k(value)
        WHERE k.value <> v_kind;
      END IF;
      v_player_changed := v_player_changed OR v_touches_kind;
    END LOOP;

    IF v_player_changed THEN
      v_metadata := jsonb_set(v_metadata, '{activeAdminCosmetics}', v_active, TRUE);
      v_metadata := jsonb_set(v_metadata, '{adminAssignedKinds}', v_admin_kinds, TRUE);
      UPDATE public.dew_cosmetics
      SET skin = v_skin,
          cape = v_cape,
          elytra = v_elytra,
          metadata = v_metadata,
          version = version + 1,
          updated_at = now()
      WHERE player_uuid = v_player.player_uuid;
      v_profiles_updated := v_profiles_updated + 1;
    END IF;
  END LOOP;

  DELETE FROM public.dew_cosmetic_library WHERE asset_id = v_item.asset_id;
  DELETE FROM public.dew_cosmetic_assignments
  WHERE lower(cosmetic_id) IN (lower(v_item.asset_id), lower(v_item.sha256));
  GET DIAGNOSTICS v_assignments_deleted = ROW_COUNT;

  DELETE FROM public.dew_cosmetic_assets a
  WHERE lower(a.sha256) = lower(v_item.asset_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.dew_cosmetic_library l
      WHERE lower(l.asset_id) = lower(a.sha256)
         OR lower(l.sha256) = lower(v_item.sha256)
    )
    AND NOT public.dew_is_cosmetic_asset_assigned(v_item.asset_id)
    AND NOT public.dew_is_cosmetic_asset_assigned(v_item.sha256);
  GET DIAGNOSTICS v_asset_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'deleted',
    'assetDeleted', v_asset_rows > 0,
    'profilesUpdated', v_profiles_updated,
    'assignmentsDeleted', v_assignments_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dew_delete_cosmetic_library_item(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_delete_cosmetic_library_item(TEXT) TO service_role;

COMMIT;


-- Migration 016: transactional launcher account synchronization.
-- Sync launcher account metadata through the current Dew account schema.
-- A stable Dew account ID is created once and reused by later heartbeats.
BEGIN;

CREATE OR REPLACE FUNCTION public.dew_sync_client_accounts(
  p_client_id TEXT,
  p_accounts JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_account JSONB;
  v_uuid TEXT;
  v_username TEXT;
  v_type TEXT;
  v_account_type TEXT;
  v_identity_type TEXT;
  v_dew_account_id UUID;
  v_last_used_at TIMESTAMPTZ;
  v_account_uuids TEXT[] := ARRAY[]::TEXT[];
  v_synced INTEGER := 0;
BEGIN
  IF p_client_id IS NULL OR p_client_id = ''
     OR jsonb_typeof(p_accounts) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid client account sync payload.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_accounts) > 100 THEN
    RAISE EXCEPTION 'Invalid client account sync payload.' USING ERRCODE = '22023';
  END IF;

  FOR v_account IN SELECT value FROM jsonb_array_elements(p_accounts) AS entries(value) LOOP
    v_uuid := lower(COALESCE(v_account->>'uuid', ''));
    v_username := COALESCE(v_account->>'username', '');
    v_type := lower(COALESCE(v_account->>'type', ''));
    IF v_uuid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR v_username !~ '^[A-Za-z0-9_]{3,16}$'
       OR v_type NOT IN ('microsoft', 'offline') THEN
      RAISE EXCEPTION 'Invalid account in client sync payload.' USING ERRCODE = '22023';
    END IF;

    v_account_type := CASE WHEN v_type = 'microsoft' THEN 'online' ELSE 'offline' END;
    v_identity_type := CASE WHEN v_type = 'microsoft' THEN 'online_minecraft' ELSE 'offline_minecraft' END;
    v_last_used_at := COALESCE(NULLIF(v_account->>'lastUsedAt', '')::TIMESTAMPTZ, now());

    -- Serialize first-seen accounts so concurrent heartbeats cannot replace
    -- the stable Dew account ID with a second generated ID.
    PERFORM pg_advisory_xact_lock(hashtextextended('minecraft-account:' || v_uuid, 0));
    SELECT dew_account_id INTO v_dew_account_id
    FROM public.dew_accounts
    WHERE uuid = v_uuid
    FOR UPDATE;
    IF NOT FOUND THEN
      v_dew_account_id := gen_random_uuid();
    END IF;

    INSERT INTO public.dew_accounts(
      uuid, username, type, account_type, dew_account_id, username_normalized,
      minecraft_uuid, minecraft_username, avatar_url, client_id, last_used_at,
      is_active, last_seen_at, updated_at
    ) VALUES (
      v_uuid, v_username, v_type, v_account_type, v_dew_account_id, lower(v_username),
      v_uuid::UUID, v_username, 'https://mc-heads.net/avatar/' || v_username || '/64',
      p_client_id, v_last_used_at, TRUE, now(), now()
    )
    ON CONFLICT (uuid) DO UPDATE SET
      username = EXCLUDED.username,
      type = EXCLUDED.type,
      account_type = EXCLUDED.account_type,
      username_normalized = EXCLUDED.username_normalized,
      minecraft_uuid = EXCLUDED.minecraft_uuid,
      minecraft_username = EXCLUDED.minecraft_username,
      avatar_url = EXCLUDED.avatar_url,
      client_id = EXCLUDED.client_id,
      last_used_at = EXCLUDED.last_used_at,
      is_active = TRUE,
      last_seen_at = now(),
      updated_at = now();

    INSERT INTO public.dew_account_identities(
      account_uuid, dew_account_id, identity_type, external_uuid, username,
      is_primary, updated_at, last_seen_at
    ) VALUES (
      v_uuid, v_dew_account_id, v_identity_type, v_uuid::UUID, v_username,
      TRUE, now(), now()
    )
    ON CONFLICT (dew_account_id, identity_type, external_uuid) DO UPDATE SET
      account_uuid = EXCLUDED.account_uuid,
      username = EXCLUDED.username,
      is_primary = TRUE,
      updated_at = now(),
      last_seen_at = now();

    v_account_uuids := array_append(v_account_uuids, v_uuid);
    v_synced := v_synced + 1;
  END LOOP;

  -- Retain the existing privacy behavior: an account removed from this
  -- client's signed sharing list is removed from its saved server records.
  DELETE FROM public.dew_accounts
  WHERE client_id = p_client_id
    AND NOT (lower(uuid) = ANY(v_account_uuids));

  RETURN v_synced;
END;
$$;

REVOKE ALL ON FUNCTION public.dew_sync_client_accounts(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_sync_client_accounts(TEXT, JSONB) TO service_role;

COMMIT;


-- Migration 017: fix Discord profile UUID validation.
-- Minecraft offline player UUIDs are MD5 name UUIDs (version 3), not UUIDv5.
-- Keep accepting existing v5 rows while creating and validating v3 UUIDs.
BEGIN;

ALTER TABLE public.dew_discord_accounts
  DROP CONSTRAINT IF EXISTS dew_discord_accounts_player_uuid_check;

ALTER TABLE public.dew_discord_accounts
  ADD CONSTRAINT dew_discord_accounts_player_uuid_check
  CHECK (player_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[35][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

CREATE OR REPLACE FUNCTION public.dew_create_discord_account(
    p_discord_user_id TEXT,
    p_player_uuid TEXT,
    p_username TEXT,
    p_guild_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_account public.dew_discord_accounts%ROWTYPE;
    v_dew_account_id UUID := gen_random_uuid();
    v_hash TEXT;
    v_expected_uuid TEXT;
BEGIN
    IF p_discord_user_id !~ '^[0-9]{17,20}$'
       OR p_player_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR p_username !~ '^[A-Za-z0-9_]{3,16}$'
       OR p_guild_id !~ '^[0-9]{17,20}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    -- Derive the expected Minecraft offline UUID server-side. This prevents a
    -- UUID/name mismatch and matches the launcher's MD5-based version-3 UUID.
    v_hash := md5('OfflinePlayer:' || p_username);
    v_expected_uuid := substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4) || '-3' || substr(v_hash, 14, 3)
      || '-' || translate(substr(v_hash, 17, 1), '0123456789abcdef', '89ab89ab89ab89ab') || substr(v_hash, 18, 3)
      || '-' || substr(v_hash, 21, 12);
    IF lower(p_player_uuid) <> lower(v_expected_uuid) THEN
      RETURN jsonb_build_object('status', 'invalid_uuid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('discord-account:' || p_discord_user_id, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('minecraft-name:' || lower(p_username), 0));

    SELECT * INTO v_account FROM public.dew_discord_accounts
    WHERE discord_user_id = p_discord_user_id FOR UPDATE;
    IF FOUND THEN
      RETURN jsonb_build_object('status', 'exists', 'account', to_jsonb(v_account));
    END IF;

    IF EXISTS (SELECT 1 FROM public.dew_accounts WHERE lower(username) = lower(p_username))
       OR EXISTS (SELECT 1 FROM public.dew_accounts WHERE lower(uuid) = lower(p_player_uuid))
       OR EXISTS (SELECT 1 FROM public.dew_discord_accounts WHERE lower(username) = lower(p_username)) THEN
      RETURN jsonb_build_object('status', 'username_taken');
    END IF;

    INSERT INTO public.dew_discord_accounts(discord_user_id, player_uuid, username, last_username_change_at)
    VALUES (p_discord_user_id, lower(p_player_uuid), p_username, now())
    RETURNING * INTO v_account;

    INSERT INTO public.dew_accounts(
      uuid, username, type, account_type, dew_account_id, username_normalized,
      minecraft_uuid, minecraft_username, avatar_url, last_used_at, updated_at
    ) VALUES (
      lower(p_player_uuid), p_username, 'offline', 'offline', v_dew_account_id, lower(p_username),
      lower(p_player_uuid)::uuid, p_username, 'https://mc-heads.net/avatar/' || p_username || '/64', now(), now()
    );

    INSERT INTO public.dew_account_identities(
      account_uuid, dew_account_id, identity_type, external_uuid, username, is_primary
    ) VALUES (
      lower(p_player_uuid), v_dew_account_id, 'offline_minecraft', lower(p_player_uuid)::uuid, p_username, TRUE
    );

    RETURN jsonb_build_object('status', 'created', 'account', to_jsonb(v_account));
EXCEPTION WHEN unique_violation THEN
    -- A concurrent insert can still win between the availability check and
    -- insert. Keep the response actionable without exposing database details.
    RETURN jsonb_build_object('status', 'conflict');
END;
$$;

REVOKE ALL ON FUNCTION public.dew_create_discord_account(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_create_discord_account(TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMIT;

-- Make free cape claims idempotently repair the player's collection and
-- active selection. Players can also select any cape they have claimed.
BEGIN;

CREATE OR REPLACE FUNCTION public.dew_claim_free_cosmetic_for_linked_player(
    p_asset_id TEXT,
    p_player_uuid TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_cosmetic public.dew_cosmetic_library%ROWTYPE;
    v_player public.dew_cosmetics%ROWTYPE;
    v_discord_user_id TEXT;
    v_username TEXT;
    v_cosmetic_json JSONB;
    v_capes JSONB;
    v_metadata JSONB;
    v_selected_id TEXT;
    v_selected_cape JSONB;
    v_rows INTEGER;
    v_already_claimed BOOLEAN;
BEGIN
    IF p_asset_id !~* '^[a-f0-9]{64}$'
       OR p_player_uuid !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('player:' || lower(p_player_uuid), 0));
    SELECT discord_user_id, minecraft_username INTO v_discord_user_id, v_username
    FROM public.dew_discord_account_links
    WHERE lower(player_uuid) = lower(p_player_uuid);
    IF v_discord_user_id IS NULL THEN
        RETURN jsonb_build_object('status', 'link_required');
    END IF;

    SELECT * INTO v_cosmetic FROM public.dew_cosmetic_library
    WHERE asset_id = lower(p_asset_id) AND is_free = TRUE AND kind = 'cape';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_available');
    END IF;

    INSERT INTO public.dew_free_cosmetic_claims(asset_id, player_uuid, discord_user_id)
    VALUES (v_cosmetic.asset_id, lower(p_player_uuid), v_discord_user_id)
    ON CONFLICT (asset_id, player_uuid) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_already_claimed := v_rows = 0;

    SELECT * INTO v_player FROM public.dew_cosmetics
    WHERE lower(player_uuid) = lower(p_player_uuid) FOR UPDATE;
    v_metadata := COALESCE(v_player.metadata, '{}'::jsonb);

    v_cosmetic_json := jsonb_build_object(
        'assetId', v_cosmetic.asset_id,
        'sha256', v_cosmetic.sha256,
        'name', v_cosmetic.name,
        'contentType', v_cosmetic.content_type,
        'byteSize', v_cosmetic.byte_size,
        'width', v_cosmetic.width,
        'height', v_cosmetic.height,
        'enabled', TRUE,
        'updatedAt', now()
    );

    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_capes
    FROM (
        SELECT DISTINCT ON (lower(item->>'assetId')) item
        FROM (
            SELECT entry AS item
            FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(v_metadata->'capes') = 'array'
                     THEN v_metadata->'capes' ELSE '[]'::jsonb END
            ) AS current_cape(entry)
            UNION ALL
            SELECT v_player.cape WHERE v_player.cape->>'enabled' = 'true'
            UNION ALL
            SELECT v_cosmetic_json
        ) AS candidates
        WHERE item->>'enabled' = 'true'
          AND item->>'assetId' ~* '^[a-f0-9]{64}$'
          AND item->>'sha256' ~* '^[a-f0-9]{64}$'
        ORDER BY lower(item->>'assetId'), (item->>'assetId' = v_cosmetic.asset_id) DESC
    ) AS unique_capes;

    v_selected_id := NULLIF(v_metadata->>'activeCapeAssetId', '');
    IF v_selected_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_capes) AS item(value)
        WHERE lower(value->>'assetId') = lower(v_selected_id)
    ) THEN
        v_selected_id := CASE
            WHEN v_player.cape->>'enabled' = 'true'
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_capes) AS item(value)
                         WHERE lower(value->>'assetId') = lower(v_player.cape->>'assetId'))
            THEN v_player.cape->>'assetId'
            ELSE v_cosmetic.asset_id
        END;
    END IF;

    SELECT value INTO v_selected_cape
    FROM jsonb_array_elements(v_capes) AS item(value)
    WHERE lower(value->>'assetId') = lower(v_selected_id)
    LIMIT 1;

    v_metadata := v_metadata || jsonb_build_object(
        'capes', v_capes,
        'activeCapeAssetId', v_selected_id,
        'activeAdminCosmetics', COALESCE(v_metadata->'activeAdminCosmetics', '{}'::jsonb)
    );

    INSERT INTO public.dew_cosmetics(player_uuid, username, version, cape, metadata, updated_at)
    VALUES (lower(p_player_uuid), v_username, 1, v_selected_cape, v_metadata, now())
    ON CONFLICT (player_uuid) DO UPDATE
       SET username = EXCLUDED.username,
           cape = EXCLUDED.cape,
           metadata = EXCLUDED.metadata,
           version = public.dew_cosmetics.version + 1,
           updated_at = now();

    RETURN jsonb_build_object(
        'status', CASE WHEN v_already_claimed THEN 'already_claimed' ELSE 'claimed' END,
        'assetId', v_cosmetic.asset_id,
        'selectedCapeAssetId', v_selected_id,
        'equipped', lower(v_selected_id) = lower(v_cosmetic.asset_id),
        'playerUuid', lower(p_player_uuid)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.dew_select_claimed_free_cape(
    p_asset_id TEXT,
    p_player_uuid TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_cosmetic public.dew_cosmetic_library%ROWTYPE;
    v_player public.dew_cosmetics%ROWTYPE;
    v_cosmetic_json JSONB;
    v_capes JSONB;
    v_metadata JSONB;
    v_username TEXT;
BEGIN
    IF p_asset_id !~* '^[a-f0-9]{64}$'
       OR p_player_uuid !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('player:' || lower(p_player_uuid), 0));
    IF NOT EXISTS (
        SELECT 1 FROM public.dew_free_cosmetic_claims
        WHERE lower(player_uuid) = lower(p_player_uuid) AND asset_id = lower(p_asset_id)
    ) THEN
        RETURN jsonb_build_object('status', 'not_owned');
    END IF;

    SELECT * INTO v_cosmetic FROM public.dew_cosmetic_library
    WHERE asset_id = lower(p_asset_id) AND is_free = TRUE AND kind = 'cape';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_available');
    END IF;

    SELECT * INTO v_player FROM public.dew_cosmetics
    WHERE lower(player_uuid) = lower(p_player_uuid) FOR UPDATE;
    v_metadata := COALESCE(v_player.metadata, '{}'::jsonb);
    IF COALESCE(v_metadata->'adminAssignedKinds', '[]'::jsonb) ? 'cape' THEN
        RETURN jsonb_build_object('status', 'admin_override');
    END IF;

    v_cosmetic_json := jsonb_build_object(
        'assetId', v_cosmetic.asset_id,
        'sha256', v_cosmetic.sha256,
        'name', v_cosmetic.name,
        'contentType', v_cosmetic.content_type,
        'byteSize', v_cosmetic.byte_size,
        'width', v_cosmetic.width,
        'height', v_cosmetic.height,
        'enabled', TRUE,
        'updatedAt', now()
    );
    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_capes
    FROM (
        SELECT DISTINCT ON (lower(candidate->>'assetId')) candidate AS item
        FROM (
            SELECT entry AS candidate
            FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(v_metadata->'capes') = 'array'
                     THEN v_metadata->'capes' ELSE '[]'::jsonb END
            ) AS current_cape(entry)
            UNION ALL
            SELECT v_cosmetic_json
        ) AS candidates
        WHERE candidate->>'enabled' = 'true'
          AND candidate->>'assetId' ~* '^[a-f0-9]{64}$'
          AND candidate->>'sha256' ~* '^[a-f0-9]{64}$'
        ORDER BY lower(candidate->>'assetId'), (candidate->>'assetId' = v_cosmetic.asset_id) DESC
    ) AS unique_capes;

    SELECT COALESCE(v_player.username, link.minecraft_username, account.username)
      INTO v_username
    FROM (SELECT 1) AS seed
    LEFT JOIN public.dew_discord_account_links link ON lower(link.player_uuid) = lower(p_player_uuid)
    LEFT JOIN public.dew_accounts account ON lower(account.uuid::text) = lower(p_player_uuid);
    IF v_username IS NULL OR length(trim(v_username)) = 0 THEN
        RETURN jsonb_build_object('status', 'profile_missing');
    END IF;

    v_metadata := v_metadata || jsonb_build_object(
        'capes', v_capes,
        'activeCapeAssetId', v_cosmetic.asset_id,
        'activeAdminCosmetics', COALESCE(v_metadata->'activeAdminCosmetics', '{}'::jsonb)
    );

    INSERT INTO public.dew_cosmetics(player_uuid, username, version, cape, metadata, updated_at)
    VALUES (lower(p_player_uuid), v_username, 1, v_cosmetic_json, v_metadata, now())
    ON CONFLICT (player_uuid) DO UPDATE
       SET username = EXCLUDED.username,
           cape = EXCLUDED.cape,
           metadata = EXCLUDED.metadata,
           version = public.dew_cosmetics.version + 1,
           updated_at = now();

    RETURN jsonb_build_object('status', 'equipped', 'assetId', v_cosmetic.asset_id, 'playerUuid', lower(p_player_uuid));
END;
$$;

REVOKE ALL ON FUNCTION public.dew_claim_free_cosmetic_for_linked_player(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dew_select_claimed_free_cape(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_claim_free_cosmetic_for_linked_player(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dew_select_claimed_free_cape(TEXT, TEXT) TO service_role;

COMMIT;

-- Publish the immutable Windows 1.0.0 installer and its integrity metadata.
-- This preserves all existing manifest fields and does not change account data.
BEGIN;

INSERT INTO public.dew_manifest AS current_manifest (id, snapshot, updated_at)
VALUES (
    'primary',
    jsonb_build_object(
        'client', jsonb_build_object(
            'latestVersion', '1.0.0',
            'minimumVersion', '1.0.0',
            'updateUrl', 'https://server.dewclient.fun/downloads/DewClient-1.0.0.exe',
            'notesUrl', 'https://dewclient.fun/news.html',
            'sha256', '7c6b85ba1f4f6cf862ed313c4c666180050e614eee1e041830f1c7ee1d723cf2',
            'sizeBytes', 85645252
        )
    ),
    now()
)
ON CONFLICT (id) DO UPDATE
SET snapshot = COALESCE(current_manifest.snapshot, '{}'::jsonb) || jsonb_build_object(
        'client',
        (CASE
            WHEN jsonb_typeof(current_manifest.snapshot->'client') = 'object'
            THEN current_manifest.snapshot->'client'
            ELSE '{}'::jsonb
        END) || jsonb_build_object(
            'latestVersion', '1.0.0',
            'minimumVersion', '1.0.0',
            'updateUrl', 'https://server.dewclient.fun/downloads/DewClient-1.0.0.exe',
            'notesUrl', 'https://dewclient.fun/news.html',
            'sha256', '7c6b85ba1f4f6cf862ed313c4c666180050e614eee1e041830f1c7ee1d723cf2',
            'sizeBytes', 85645252
        )
    ),
    updated_at = now();

COMMIT;
