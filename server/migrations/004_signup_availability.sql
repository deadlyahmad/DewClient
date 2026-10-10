CREATE OR REPLACE FUNCTION public.dew_check_signup_availability(p_username TEXT DEFAULT NULL, p_email TEXT DEFAULT NULL)
RETURNS TABLE(username_available BOOLEAN, email_available BOOLEAN)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
    SELECT
        p_username IS NULL OR NOT EXISTS (
            SELECT 1 FROM auth.users AS auth_user
            WHERE lower(btrim(auth_user.raw_user_meta_data ->> 'username')) = lower(btrim(p_username))
        ),
        p_email IS NULL OR NOT EXISTS (
            SELECT 1 FROM auth.users AS auth_user
            WHERE lower(btrim(auth_user.email)) = lower(btrim(p_email))
        );
$$;

REVOKE ALL ON FUNCTION public.dew_check_signup_availability(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dew_check_signup_availability(TEXT, TEXT) TO service_role;