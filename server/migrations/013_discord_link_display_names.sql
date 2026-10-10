-- Keep the Discord identity label supplied by the signed Discord interaction so
-- the launcher can show which account is linked to a Minecraft profile.
ALTER TABLE public.dew_discord_account_links
    ADD COLUMN IF NOT EXISTS discord_username TEXT,
    ADD COLUMN IF NOT EXISTS discord_display_name TEXT;

ALTER TABLE public.dew_discord_account_links
    DROP CONSTRAINT IF EXISTS dew_discord_account_links_discord_username_length_check,
    ADD CONSTRAINT dew_discord_account_links_discord_username_length_check
        CHECK (discord_username IS NULL OR char_length(discord_username) BETWEEN 1 AND 64),
    DROP CONSTRAINT IF EXISTS dew_discord_account_links_discord_display_name_length_check,
    ADD CONSTRAINT dew_discord_account_links_discord_display_name_length_check
        CHECK (discord_display_name IS NULL OR char_length(discord_display_name) BETWEEN 1 AND 80);
