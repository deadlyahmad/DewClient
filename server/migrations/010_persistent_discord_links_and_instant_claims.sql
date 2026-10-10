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
