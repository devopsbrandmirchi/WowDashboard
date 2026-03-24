-- Ensure sync history table exists for fetch-facebook-campaigns-upsert.

CREATE TABLE IF NOT EXISTS public.facebook_ads_sync_by_date (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  segment_date DATE NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, segment_date)
);

CREATE INDEX IF NOT EXISTS idx_facebook_ads_sync_by_date_d
  ON public.facebook_ads_sync_by_date (segment_date DESC);

ALTER TABLE public.facebook_ads_sync_by_date ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read facebook_ads_sync_by_date"
  ON public.facebook_ads_sync_by_date;

CREATE POLICY "Authenticated read facebook_ads_sync_by_date"
  ON public.facebook_ads_sync_by_date
  FOR SELECT
  TO authenticated
  USING (true);

