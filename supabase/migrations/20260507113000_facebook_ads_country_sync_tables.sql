-- Create country-aware Meta/Facebook sync tables without changing existing tables/functions.

CREATE TABLE IF NOT EXISTS public.facebook_campaigns_data_country
(LIKE public.facebook_campaigns_data INCLUDING ALL);

ALTER TABLE public.facebook_campaigns_data_country
ADD COLUMN IF NOT EXISTS country TEXT;

DO $$
BEGIN
  IF to_regclass('public.facebook_campaigns_data_country') IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.facebook_campaigns_data_country d
  WHERE EXISTS (
    SELECT 1
    FROM public.facebook_campaigns_data_country d2
    WHERE d2.id > d.id
      AND d2.account_id IS NOT DISTINCT FROM d.account_id
      AND d2.ad_id IS NOT DISTINCT FROM d.ad_id
      AND d2.day IS NOT DISTINCT FROM d.day
      AND d2.country IS NOT DISTINCT FROM d.country
      AND d2.platform IS NOT DISTINCT FROM d.platform
      AND d2.placement IS NOT DISTINCT FROM d.placement
      AND d2.device_platform IS NOT DISTINCT FROM d.device_platform
  );

  DROP INDEX IF EXISTS public.facebook_campaigns_data_country_upsert_unique;
  CREATE UNIQUE INDEX facebook_campaigns_data_country_upsert_unique
    ON public.facebook_campaigns_data_country (
      account_id,
      ad_id,
      day,
      country,
      platform,
      placement,
      device_platform
    ) NULLS NOT DISTINCT;
END $$;

CREATE INDEX IF NOT EXISTS idx_fcdc_day ON public.facebook_campaigns_data_country (day);
CREATE INDEX IF NOT EXISTS idx_fcdc_country ON public.facebook_campaigns_data_country (country);
CREATE INDEX IF NOT EXISTS idx_fcdc_account_day ON public.facebook_campaigns_data_country (account_id, day);

CREATE TABLE IF NOT EXISTS public.facebook_ads_sync_by_date_country (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  segment_date DATE NOT NULL,
  country TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, segment_date, country)
);
CREATE INDEX IF NOT EXISTS idx_facebook_ads_sync_by_date_country_d
  ON public.facebook_ads_sync_by_date_country (segment_date DESC);
CREATE INDEX IF NOT EXISTS idx_facebook_ads_sync_by_date_country_country
  ON public.facebook_ads_sync_by_date_country (country);

ALTER TABLE public.facebook_ads_sync_by_date_country ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read facebook_ads_sync_by_date_country"
  ON public.facebook_ads_sync_by_date_country;
CREATE POLICY "Authenticated read facebook_ads_sync_by_date_country"
  ON public.facebook_ads_sync_by_date_country FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.reset_facebook_campaigns_data_country_sequence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM setval(
    pg_get_serial_sequence('public.facebook_campaigns_data_country', 'id'),
    COALESCE((SELECT MAX(id) FROM public.facebook_campaigns_data_country), 0)
  );
END;
$$;
