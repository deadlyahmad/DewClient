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
