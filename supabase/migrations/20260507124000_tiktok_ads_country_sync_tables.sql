-- Create country-aware TikTok Ads sync tables without modifying existing TikTok tables/functions.

CREATE TABLE IF NOT EXISTS public.tiktok_campaigns_data_country
(LIKE public.tiktok_campaigns_data INCLUDING ALL);

ALTER TABLE public.tiktok_campaigns_data_country
  ADD COLUMN IF NOT EXISTS country character varying(100);

-- Drop inherited unique constraints/indexes that do not include country.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT n.nspname AS schema_name,
           c.relname AS table_name,
           con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'tiktok_campaigns_data_country'
      AND con.contype = 'u'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
      rec.schema_name, rec.table_name, rec.constraint_name
    );
  END LOOP;

  FOR rec IN
    SELECT n.nspname AS schema_name,
           ic.relname AS index_name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE n.nspname = 'public'
      AND c.relname = 'tiktok_campaigns_data_country'
      AND i.indisunique
      AND NOT i.indisprimary
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint con
        WHERE con.conindid = i.indexrelid
      )
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', rec.schema_name, rec.index_name);
  END LOOP;
END $$;

-- Dedupe pre-existing rows by the new upsert key.
DELETE FROM public.tiktok_campaigns_data_country d
WHERE EXISTS (
  SELECT 1
  FROM public.tiktok_campaigns_data_country d2
  WHERE d2.id > d.id
    AND d2.ad_id IS NOT DISTINCT FROM d.ad_id
    AND d2.date IS NOT DISTINCT FROM d.date
    AND d2.placement IS NOT DISTINCT FROM d.placement
    AND d2.country IS NOT DISTINCT FROM d.country
);

DROP INDEX IF EXISTS public.tiktok_campaigns_data_country_upsert_key;
CREATE UNIQUE INDEX tiktok_campaigns_data_country_upsert_key
  ON public.tiktok_campaigns_data_country (ad_id, date, placement, country)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_tiktok_campaigns_data_country_date
  ON public.tiktok_campaigns_data_country (date DESC);
CREATE INDEX IF NOT EXISTS idx_tiktok_campaigns_data_country_ad_id
  ON public.tiktok_campaigns_data_country (ad_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_campaigns_data_country_country
  ON public.tiktok_campaigns_data_country (country);

ALTER TABLE public.tiktok_campaigns_data_country ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated select tiktok_campaigns_data_country" ON public.tiktok_campaigns_data_country;
CREATE POLICY "Authenticated select tiktok_campaigns_data_country"
  ON public.tiktok_campaigns_data_country FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Service role all tiktok_campaigns_data_country" ON public.tiktok_campaigns_data_country;
CREATE POLICY "Service role all tiktok_campaigns_data_country"
  ON public.tiktok_campaigns_data_country FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.tiktok_ads_sync_by_date_country (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  segment_date DATE NOT NULL,
  country TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, segment_date, country)
);
CREATE INDEX IF NOT EXISTS idx_tiktok_ads_sync_by_date_country_d
  ON public.tiktok_ads_sync_by_date_country (segment_date DESC);
CREATE INDEX IF NOT EXISTS idx_tiktok_ads_sync_by_date_country_country
  ON public.tiktok_ads_sync_by_date_country (country);

ALTER TABLE public.tiktok_ads_sync_by_date_country ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read tiktok_ads_sync_by_date_country" ON public.tiktok_ads_sync_by_date_country;
CREATE POLICY "Authenticated read tiktok_ads_sync_by_date_country"
  ON public.tiktok_ads_sync_by_date_country FOR SELECT TO authenticated USING (true);

-- Allow tiktok_ads_country platform in ads_sync_by_date_log.
ALTER TABLE public.ads_sync_by_date_log
  DROP CONSTRAINT IF EXISTS ads_sync_by_date_log_platform_check;

ALTER TABLE public.ads_sync_by_date_log
  ADD CONSTRAINT ads_sync_by_date_log_platform_check CHECK (platform IN (
    'google_ads',
    'google_ads_country',
    'reddit_ads',
    'reddit_ads_country',
    'facebook_ads',
    'facebook_ads_country',
    'tiktok_ads',
    'tiktok_ads_country',
    'microsoft_ads'
  ));

CREATE OR REPLACE FUNCTION public.reset_tiktok_campaigns_data_country_sequence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_val bigint;
BEGIN
  SELECT COALESCE(MAX(id), 0) INTO next_val
  FROM public.tiktok_campaigns_data_country;

  IF next_val < 1 THEN
    next_val := 1;
  END IF;

  PERFORM setval(
    pg_get_serial_sequence('public.tiktok_campaigns_data_country', 'id'),
    next_val
  );
END;
$$;
