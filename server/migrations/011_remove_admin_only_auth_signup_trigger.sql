-- An old dashboard-era auth.users trigger allowed only a single hard-coded
-- administrator email to sign in. It broke normal Dew account registration.
-- Staff access remains governed separately by dew_admins and the admin API.
DROP TRIGGER IF EXISTS ensure_admin_only ON auth.users;
DROP FUNCTION IF EXISTS public.check_admin_email();
