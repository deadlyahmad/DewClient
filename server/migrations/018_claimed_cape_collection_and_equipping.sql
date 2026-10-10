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
