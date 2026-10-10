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
