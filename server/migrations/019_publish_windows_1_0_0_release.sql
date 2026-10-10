-- Publish the immutable Windows 1.0.0 installer and its integrity metadata.
-- This preserves all existing manifest fields and does not change account data.
BEGIN;

INSERT INTO public.dew_manifest AS current_manifest (id, snapshot, updated_at)
VALUES (
    'primary',
    jsonb_build_object(
        'client', jsonb_build_object(
            'latestVersion', '1.0.0',
            'minimumVersion', '1.0.0',
            'updateUrl', 'https://server.dewclient.fun/downloads/DewClient-1.0.0.exe',
            'notesUrl', 'https://dewclient.fun/news.html',
            'sha256', '7c6b85ba1f4f6cf862ed313c4c666180050e614eee1e041830f1c7ee1d723cf2',
            'sizeBytes', 85645252
        )
    ),
    now()
)
ON CONFLICT (id) DO UPDATE
SET snapshot = COALESCE(current_manifest.snapshot, '{}'::jsonb) || jsonb_build_object(
        'client',
        (CASE
            WHEN jsonb_typeof(current_manifest.snapshot->'client') = 'object'
            THEN current_manifest.snapshot->'client'
            ELSE '{}'::jsonb
        END) || jsonb_build_object(
            'latestVersion', '1.0.0',
            'minimumVersion', '1.0.0',
            'updateUrl', 'https://server.dewclient.fun/downloads/DewClient-1.0.0.exe',
            'notesUrl', 'https://dewclient.fun/news.html',
            'sha256', '7c6b85ba1f4f6cf862ed313c4c666180050e614eee1e041830f1c7ee1d723cf2',
            'sizeBytes', 85645252
        )
    ),
    updated_at = now();

COMMIT;
