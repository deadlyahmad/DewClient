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
