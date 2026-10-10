BEGIN;

ALTER TABLE public.dew_admins
    DROP CONSTRAINT IF EXISTS dew_admins_role_check;

UPDATE public.dew_admins
SET role = 'admin'
WHERE role IS DISTINCT FROM 'admin';

ALTER TABLE public.dew_admins
    ALTER COLUMN role SET DEFAULT 'admin';

ALTER TABLE public.dew_admins
    ADD CONSTRAINT dew_admins_role_check CHECK (role = 'admin');

COMMIT;