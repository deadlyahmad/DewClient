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
