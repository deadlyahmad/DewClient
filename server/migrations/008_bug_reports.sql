-- Bug reports contain only fields the player deliberately enters plus public
-- client/game version data. No raw logs, account identity, IP, or device id is
-- persisted by this feature.
CREATE TABLE IF NOT EXISTS public.dew_bug_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL CHECK (category IN ('launcher', 'game-launch', 'account', 'cosmetics', 'other')),
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 8 AND 120),
    description TEXT NOT NULL CHECK (char_length(description) BETWEEN 20 AND 5000),
    client_version TEXT NOT NULL CHECK (char_length(client_version) BETWEEN 1 AND 32),
    minecraft_version TEXT CHECK (minecraft_version IS NULL OR char_length(minecraft_version) <= 32),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved')),
    resolution_note TEXT CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dew_bug_reports_status_created
    ON public.dew_bug_reports(status, created_at DESC);

ALTER TABLE public.dew_bug_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dew_bug_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dew_bug_reports TO service_role;
DROP POLICY IF EXISTS "Bug reports are service-only" ON public.dew_bug_reports;
CREATE POLICY "Bug reports are service-only"
    ON public.dew_bug_reports FOR ALL TO service_role
    USING (true) WITH CHECK (true);
