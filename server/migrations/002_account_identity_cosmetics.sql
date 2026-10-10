-- 002_account_identity_cosmetics.sql
-- Add stable Dew account identity and assignment tables while preserving the legacy
-- dew_accounts.uuid field that already drives the launcher identity surface.

ALTER TABLE public.dew_accounts
    ADD COLUMN IF NOT EXISTS dew_account_id UUID,
    ADD COLUMN IF NOT EXISTS auth_user_id UUID,
    ADD COLUMN IF NOT EXISTS account_type TEXT,
    ADD COLUMN IF NOT EXISTS username_normalized TEXT,
    ADD COLUMN IF NOT EXISTS minecraft_uuid UUID,
    ADD COLUMN IF NOT EXISTS minecraft_username TEXT,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

UPDATE public.dew_accounts
SET dew_account_id = gen_random_uuid()
WHERE dew_account_id IS NULL;

UPDATE public.dew_accounts
SET account_type = CASE
    WHEN lower(trim(type)) = 'offline' THEN 'offline'
    WHEN lower(trim(type)) = 'microsoft' THEN 'online'
    WHEN lower(trim(type)) = 'online' THEN 'online'
    ELSE 'online'
END,
    username_normalized = lower(trim(username)),
    minecraft_uuid = CASE
        WHEN uuid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN uuid::uuid
        ELSE NULL
    END,
    minecraft_username = username,
    is_active = COALESCE(is_active, true),
    last_seen_at = COALESCE(last_seen_at, last_used_at, registered_at, now())
WHERE dew_account_id IS NOT NULL;

ALTER TABLE public.dew_accounts
    ALTER COLUMN dew_account_id SET NOT NULL,
    ALTER COLUMN account_type SET NOT NULL,
    ALTER COLUMN username_normalized SET NOT NULL,
    ALTER COLUMN is_active SET DEFAULT true;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dew_accounts_account_type_check' AND conrelid = 'public.dew_accounts'::regclass
    ) THEN
        ALTER TABLE public.dew_accounts
            ADD CONSTRAINT dew_accounts_account_type_check
            CHECK (account_type IN ('online', 'offline'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dew_accounts_dew_account_id_unique
    ON public.dew_accounts(dew_account_id);

CREATE INDEX IF NOT EXISTS idx_dew_accounts_account_type
    ON public.dew_accounts(account_type);

CREATE INDEX IF NOT EXISTS idx_dew_accounts_username_normalized
    ON public.dew_accounts(username_normalized);

CREATE INDEX IF NOT EXISTS idx_dew_accounts_minecraft_uuid
    ON public.dew_accounts(minecraft_uuid);

CREATE TABLE IF NOT EXISTS public.dew_account_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_uuid TEXT NOT NULL REFERENCES public.dew_accounts(uuid) ON DELETE CASCADE,
    dew_account_id UUID NOT NULL REFERENCES public.dew_accounts(dew_account_id) ON DELETE CASCADE,
    identity_type TEXT NOT NULL CHECK (identity_type IN ('online_minecraft', 'offline_minecraft', 'supabase_auth', 'future_provider')),
    external_uuid UUID,
    username TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dew_account_id, identity_type, external_uuid)
);

CREATE INDEX IF NOT EXISTS idx_dew_account_identities_account_uuid
    ON public.dew_account_identities(account_uuid);

CREATE INDEX IF NOT EXISTS idx_dew_account_identities_dew_account_id
    ON public.dew_account_identities(dew_account_id);

CREATE TABLE IF NOT EXISTS public.dew_cosmetic_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_uuid TEXT NOT NULL REFERENCES public.dew_accounts(uuid) ON DELETE CASCADE,
    dew_account_id UUID NOT NULL REFERENCES public.dew_accounts(dew_account_id) ON DELETE CASCADE,
    cosmetic_id TEXT NOT NULL,
    assigned_by TEXT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    enabled BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMPTZ,
    UNIQUE (dew_account_id, cosmetic_id)
);

CREATE INDEX IF NOT EXISTS idx_dew_cosmetic_assignments_account
    ON public.dew_cosmetic_assignments(dew_account_id);

CREATE INDEX IF NOT EXISTS idx_dew_cosmetic_assignments_cosmetic
    ON public.dew_cosmetic_assignments(cosmetic_id);

ALTER TABLE public.dew_account_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dew_cosmetic_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Account identities are service-only" ON public.dew_account_identities;
CREATE POLICY "Account identities are service-only" ON public.dew_account_identities
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Cosmetic assignments are service-only" ON public.dew_cosmetic_assignments;
CREATE POLICY "Cosmetic assignments are service-only" ON public.dew_cosmetic_assignments
    FOR ALL TO service_role USING (true) WITH CHECK (true);
