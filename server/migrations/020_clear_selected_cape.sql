-- Let a verified profile switch from a DewClient cape back to a cape chosen
-- from its Microsoft account. The owned cape collection remains untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.dew_clear_selected_cape(p_player_uuid TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_player public.dew_cosmetics%ROWTYPE;
    v_metadata JSONB;
BEGIN
    IF p_player_uuid !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('player:' || lower(p_player_uuid), 0));
    SELECT * INTO v_player FROM public.dew_cosmetics
    WHERE lower(player_uuid) = lower(p_player_uuid) FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'cleared', 'playerUuid', lower(p_player_uuid));
    END IF;

    v_metadata := COALESCE(v_player.metadata, '{}'::jsonb);
    IF COALESCE(v_metadata->'adminAssignedKinds', '[]'::jsonb) ? 'cape' THEN
        RETURN jsonb_build_object('status', 'admin_override');
    END IF;

    v_metadata := v_metadata || jsonb_build_object(
        'activeCapeAssetId', NULL,
        'activeAdminCosmetics', COALESCE(v_metadata->'activeAdminCosmetics', '{}'::jsonb)
    );
    UPDATE public.dew_cosmetics
       SET cape = NULL,
           metadata = v_metadata,
           version = version + 1,
           updated_at = now()
     WHERE lower(player_uuid) = lower(p_player_uuid);

    RETURN jsonb_build_object('status', 'cleared', 'playerUuid', lower(p_player_uuid));
END;
$$;

REVOKE ALL ON FUNCTION public.dew_clear_selected_cape(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_clear_selected_cape(TEXT) TO service_role;

COMMIT;
