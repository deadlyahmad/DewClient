-- Remove defaults that could save a placeholder identity or client version.
ALTER TABLE public.dew_clients
    ALTER COLUMN client_version DROP DEFAULT;

ALTER TABLE public.dew_accounts
    ALTER COLUMN type DROP DEFAULT;