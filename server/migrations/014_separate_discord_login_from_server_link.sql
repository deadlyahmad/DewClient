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
