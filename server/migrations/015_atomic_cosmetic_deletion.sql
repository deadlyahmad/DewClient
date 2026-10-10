-- Delete cosmetics through one database transaction, including orphaned binary
-- assets. The assignment guard sees every profile and the legacy assignment table.
BEGIN;

CREATE OR REPLACE FUNCTION public.dew_is_cosmetic_asset_assigned(p_sha256 TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_sha256 IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.dew_cosmetics d
      WHERE lower(COALESCE(d.skin->>'assetId', '')) = lower(p_sha256)
         OR lower(COALESCE(d.skin->>'sha256', '')) = lower(p_sha256)
         OR lower(COALESCE(d.cape->>'assetId', '')) = lower(p_sha256)
         OR lower(COALESCE(d.cape->>'sha256', '')) = lower(p_sha256)
         OR lower(COALESCE(d.elytra->>'assetId', '')) = lower(p_sha256)
         OR lower(COALESCE(d.elytra->>'sha256', '')) = lower(p_sha256)
         OR lower(COALESCE(d.metadata->'activeAdminCosmetics'->>'skin', '')) = lower(p_sha256)
         OR lower(COALESCE(d.metadata->'activeAdminCosmetics'->>'cape', '')) = lower(p_sha256)
         OR lower(COALESCE(d.metadata->'activeAdminCosmetics'->>'elytra', '')) = lower(p_sha256)
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(d.metadata->'skins') = 'array' THEN d.metadata->'skins' ELSE '[]'::jsonb END
           ) AS item(value)
           WHERE lower(COALESCE(item.value->>'assetId', '')) = lower(p_sha256)
              OR lower(COALESCE(item.value->>'sha256', '')) = lower(p_sha256)
         )
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(d.metadata->'capes') = 'array' THEN d.metadata->'capes' ELSE '[]'::jsonb END
           ) AS item(value)
           WHERE lower(COALESCE(item.value->>'assetId', '')) = lower(p_sha256)
              OR lower(COALESCE(item.value->>'sha256', '')) = lower(p_sha256)
         )
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(d.metadata->'elytras') = 'array' THEN d.metadata->'elytras' ELSE '[]'::jsonb END
           ) AS item(value)
           WHERE lower(COALESCE(item.value->>'assetId', '')) = lower(p_sha256)
              OR lower(COALESCE(item.value->>'sha256', '')) = lower(p_sha256)
         )
    )
    OR EXISTS (
      SELECT 1
      FROM public.dew_cosmetic_assignments a
      WHERE lower(a.cosmetic_id) = lower(p_sha256)
        AND a.enabled = TRUE
        AND (a.expires_at IS NULL OR a.expires_at > now())
    )
  );
$$;

REVOKE ALL ON FUNCTION public.dew_is_cosmetic_asset_assigned(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_is_cosmetic_asset_assigned(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.dew_delete_cosmetic_library_item(p_asset_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_item public.dew_cosmetic_library%ROWTYPE;
  v_player public.dew_cosmetics%ROWTYPE;
  v_metadata JSONB;
  v_active JSONB;
  v_admin_kinds JSONB;
  v_collection_key TEXT;
  v_list JSONB;
  v_filtered JSONB;
  v_direct JSONB;
  v_replacement JSONB;
  v_replacement_id TEXT;
  v_kind TEXT;
  v_direct_matches BOOLEAN;
  v_active_matches BOOLEAN;
  v_collection_changed BOOLEAN;
  v_touches_kind BOOLEAN;
  v_player_changed BOOLEAN;
  v_skin JSONB;
  v_cape JSONB;
  v_elytra JSONB;
  v_profiles_updated INTEGER := 0;
  v_assignments_deleted INTEGER := 0;
  v_asset_rows INTEGER := 0;
BEGIN
  IF p_asset_id IS NULL OR p_asset_id !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cosmetic-library:' || lower(p_asset_id), 0));
  SELECT * INTO v_item
  FROM public.dew_cosmetic_library
  WHERE lower(asset_id) = lower(p_asset_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Remove the texture from every player's current selection and assigned
  -- collection in the same transaction as the library and binary rows.
  FOR v_player IN SELECT * FROM public.dew_cosmetics FOR UPDATE LOOP
    v_metadata := COALESCE(v_player.metadata, '{}'::jsonb);
    IF jsonb_typeof(v_metadata) <> 'object' THEN v_metadata := '{}'::jsonb; END IF;
    v_active := CASE WHEN jsonb_typeof(v_metadata->'activeAdminCosmetics') = 'object'
      THEN v_metadata->'activeAdminCosmetics' ELSE '{}'::jsonb END;
    v_admin_kinds := CASE WHEN jsonb_typeof(v_metadata->'adminAssignedKinds') = 'array'
      THEN v_metadata->'adminAssignedKinds' ELSE '[]'::jsonb END;
    v_skin := v_player.skin;
    v_cape := v_player.cape;
    v_elytra := v_player.elytra;
    v_player_changed := FALSE;

    FOREACH v_kind IN ARRAY ARRAY['skin', 'cape', 'elytra'] LOOP
      v_collection_key := CASE v_kind WHEN 'skin' THEN 'skins' WHEN 'cape' THEN 'capes' ELSE 'elytras' END;
      v_direct := CASE v_kind WHEN 'skin' THEN v_player.skin WHEN 'cape' THEN v_player.cape ELSE v_player.elytra END;
      v_list := CASE WHEN jsonb_typeof(v_metadata->v_collection_key) = 'array'
        THEN v_metadata->v_collection_key ELSE '[]'::jsonb END;

      SELECT COALESCE(jsonb_agg(entry.value ORDER BY entry.ordinality), '[]'::jsonb)
        INTO v_filtered
      FROM jsonb_array_elements(v_list) WITH ORDINALITY AS entry(value, ordinality)
      WHERE lower(COALESCE(entry.value->>'assetId', '')) NOT IN (lower(v_item.asset_id), lower(v_item.sha256))
        AND lower(COALESCE(entry.value->>'sha256', '')) NOT IN (lower(v_item.asset_id), lower(v_item.sha256));

      v_direct_matches :=
        lower(COALESCE(v_direct->>'assetId', '')) IN (lower(v_item.asset_id), lower(v_item.sha256))
        OR lower(COALESCE(v_direct->>'sha256', '')) IN (lower(v_item.asset_id), lower(v_item.sha256));
      v_active_matches := lower(COALESCE(v_active->>v_kind, '')) IN (lower(v_item.asset_id), lower(v_item.sha256));
      v_collection_changed := v_filtered IS DISTINCT FROM v_list;
      v_touches_kind := v_direct_matches OR v_active_matches OR v_collection_changed;

      IF v_collection_changed THEN
        v_metadata := jsonb_set(v_metadata, ARRAY[v_collection_key], v_filtered, TRUE);
      END IF;
      IF v_direct_matches THEN
        IF v_kind = 'skin' THEN v_skin := v_filtered->0;
        ELSIF v_kind = 'cape' THEN v_cape := v_filtered->0;
        ELSE v_elytra := v_filtered->0;
        END IF;
      END IF;
      IF v_active_matches THEN
        IF v_direct_matches THEN
          v_replacement := v_filtered->0;
        ELSE
          v_replacement := COALESCE(v_direct, v_filtered->0);
        END IF;
        v_replacement_id := COALESCE(v_replacement->>'assetId', v_replacement->>'sha256');
        IF v_replacement_id IS NULL OR v_replacement_id = '' THEN
          v_active := v_active - v_kind;
        ELSE
          v_active := jsonb_set(v_active, ARRAY[v_kind], to_jsonb(v_replacement_id), TRUE);
        END IF;
      END IF;

      IF v_touches_kind
         AND jsonb_array_length(v_filtered) = 0
         AND (v_direct_matches OR v_direct IS NULL)
         AND v_admin_kinds ? v_kind THEN
        SELECT COALESCE(jsonb_agg(k.value), '[]'::jsonb) INTO v_admin_kinds
        FROM jsonb_array_elements_text(v_admin_kinds) AS k(value)
        WHERE k.value <> v_kind;
      END IF;
      v_player_changed := v_player_changed OR v_touches_kind;
    END LOOP;

    IF v_player_changed THEN
      v_metadata := jsonb_set(v_metadata, '{activeAdminCosmetics}', v_active, TRUE);
      v_metadata := jsonb_set(v_metadata, '{adminAssignedKinds}', v_admin_kinds, TRUE);
      UPDATE public.dew_cosmetics
      SET skin = v_skin,
          cape = v_cape,
          elytra = v_elytra,
          metadata = v_metadata,
          version = version + 1,
          updated_at = now()
      WHERE player_uuid = v_player.player_uuid;
      v_profiles_updated := v_profiles_updated + 1;
    END IF;
  END LOOP;

  DELETE FROM public.dew_cosmetic_library WHERE asset_id = v_item.asset_id;
  DELETE FROM public.dew_cosmetic_assignments
  WHERE lower(cosmetic_id) IN (lower(v_item.asset_id), lower(v_item.sha256));
  GET DIAGNOSTICS v_assignments_deleted = ROW_COUNT;

  DELETE FROM public.dew_cosmetic_assets a
  WHERE lower(a.sha256) = lower(v_item.asset_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.dew_cosmetic_library l
      WHERE lower(l.asset_id) = lower(a.sha256)
         OR lower(l.sha256) = lower(v_item.sha256)
    )
    AND NOT public.dew_is_cosmetic_asset_assigned(v_item.asset_id)
    AND NOT public.dew_is_cosmetic_asset_assigned(v_item.sha256);
  GET DIAGNOSTICS v_asset_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'deleted',
    'assetDeleted', v_asset_rows > 0,
    'profilesUpdated', v_profiles_updated,
    'assignmentsDeleted', v_assignments_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dew_delete_cosmetic_library_item(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_delete_cosmetic_library_item(TEXT) TO service_role;

COMMIT;
