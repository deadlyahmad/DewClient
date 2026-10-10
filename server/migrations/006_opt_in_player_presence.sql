BEGIN;

CREATE TABLE IF NOT EXISTS public.dew_player_presence (
    player_uuid TEXT PRIMARY KEY,
    username TEXT NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,16}$'),
    client_id TEXT NOT NULL REFERENCES public.dew_clients(id) ON DELETE CASCADE,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dew_player_presence_last_seen
    ON public.dew_player_presence(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_dew_player_presence_client
    ON public.dew_player_presence(client_id);

ALTER TABLE public.dew_player_presence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Player presence is service-only" ON public.dew_player_presence;
CREATE POLICY "Player presence is service-only"
    ON public.dew_player_presence FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
