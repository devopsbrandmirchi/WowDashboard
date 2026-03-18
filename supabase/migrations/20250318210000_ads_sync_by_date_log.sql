-- Append-only log: every successful upsert sync writes one row per (platform, account, segment_date).
-- run_id groups all rows from a single edge function invocation.
CREATE TABLE IF NOT EXISTS public.ads_sync_by_date_log (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  segment_date DATE NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_id UUID NOT NULL,
  date_range_start DATE,
  date_range_end DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ads_sync_by_date_log_platform_check CHECK (platform IN (
    'google_ads', 'reddit_ads', 'facebook_ads', 'tiktok_ads'
  ))
);

CREATE INDEX IF NOT EXISTS idx_ads_sync_log_platform_account_date
  ON public.ads_sync_by_date_log (platform, account_id, segment_date DESC);
CREATE INDEX IF NOT EXISTS idx_ads_sync_log_run_id ON public.ads_sync_by_date_log (run_id);
CREATE INDEX IF NOT EXISTS idx_ads_sync_log_synced_at ON public.ads_sync_by_date_log (synced_at DESC);

ALTER TABLE public.ads_sync_by_date_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read ads_sync_by_date_log" ON public.ads_sync_by_date_log;
CREATE POLICY "Authenticated read ads_sync_by_date_log"
  ON public.ads_sync_by_date_log FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.ads_sync_by_date_log IS 'Audit log of ads syncs by date; use run_id to group one API run.';
