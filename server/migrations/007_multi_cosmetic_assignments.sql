-- Keep every admin-assigned texture protected from deletion while it is assigned.
-- Collection values contain the same enabled asset references as the legacy primary fields.
CREATE OR REPLACE FUNCTION public.dew_is_cosmetic_asset_assigned(p_sha256 TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.dew_cosmetics
        WHERE skin @> jsonb_build_object('enabled', true, 'sha256', p_sha256)
           OR cape @> jsonb_build_object('enabled', true, 'sha256', p_sha256)
           OR elytra @> jsonb_build_object('enabled', true, 'sha256', p_sha256)
           OR (metadata->'skins') @> jsonb_build_array(jsonb_build_object('enabled', true, 'sha256', p_sha256))
           OR (metadata->'capes') @> jsonb_build_array(jsonb_build_object('enabled', true, 'sha256', p_sha256))
           OR (metadata->'elytras') @> jsonb_build_array(jsonb_build_object('enabled', true, 'sha256', p_sha256))
    );
$$;

REVOKE ALL ON FUNCTION public.dew_is_cosmetic_asset_assigned(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_is_cosmetic_asset_assigned(TEXT) TO service_role;
