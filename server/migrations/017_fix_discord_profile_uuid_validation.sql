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
