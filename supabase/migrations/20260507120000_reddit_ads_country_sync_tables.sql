-- Create country-aware Reddit Ads sync tables without changing existing tables/functions.
-- Mirrors reddit_campaigns_ad_group / reddit_campaigns_placement with an extra country column,
-- and adds a sync-history table that includes country plus the platform-check entry for the log.

CREATE TABLE IF NOT EXISTS public.reddit_campaigns_ad_group_country
(LIKE public.reddit_campaigns_ad_group INCLUDING ALL);

CREATE TABLE IF NOT EXISTS public.reddit_campaigns_placement_country
(LIKE public.reddit_campaigns_placement INCLUDING ALL);

ALTER TABLE public.reddit_campaigns_ad_group_country
  ADD COLUMN IF NOT EXISTS country TEXT;

ALTER TABLE public.reddit_campaigns_placement_country
  ADD COLUMN IF NOT EXISTS country TEXT;

-- Make sure columns the country edge function writes always exist (defensive parity with the
-- legacy placement table where these were added piecemeal).
ALTER TABLE public.reddit_campaigns_ad_group_country
  ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(100);
ALTER TABLE public.reddit_campaigns_ad_group_country
  ADD COLUMN IF NOT EXISTS ad_group_id VARCHAR(100);
ALTER TABLE public.reddit_campaigns_placement_country
  ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(100);
ALTER TABLE public.reddit_campaigns_placement_country
  ADD COLUMN IF NOT EXISTS total_value_purchase numeric(12,4);

-- Drop any unique constraints / indexes inherited from LIKE that don't include country,
-- so the same ad_group / placement / campaign row can exist for multiple countries.
-- We drop unique constraints first (which removes the backing index), then any leftover
-- unique indexes that have no constraint behind them.
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
      AND c.relname IN ('reddit_campaigns_ad_group_country', 'reddit_campaigns_placement_country')
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
      AND c.relname IN ('reddit_campaigns_ad_group_country', 'reddit_campaigns_placement_country')
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

-- Dedupe any pre-existing rows by the new (account, campaign, country, ...) keys before
-- creating the unique upsert indexes.
DO $$
BEGIN
  IF to_regclass('public.reddit_campaigns_ad_group_country') IS NOT NULL THEN
    DELETE FROM public.reddit_campaigns_ad_group_country d
    WHERE EXISTS (
      SELECT 1
      FROM public.reddit_campaigns_ad_group_country d2
      WHERE d2.id > d.id
        AND d2.account_id IS NOT DISTINCT FROM d.account_id
        AND d2.campaign_date IS NOT DISTINCT FROM d.campaign_date
        AND d2.campaign_name IS NOT DISTINCT FROM d.campaign_name
        AND d2.ad_group_name IS NOT DISTINCT FROM d.ad_group_name
        AND d2.country IS NOT DISTINCT FROM d.country
    );
  END IF;
  IF to_regclass('public.reddit_campaigns_placement_country') IS NOT NULL THEN
    DELETE FROM public.reddit_campaigns_placement_country d
    WHERE EXISTS (
      SELECT 1
      FROM public.reddit_campaigns_placement_country d2
      WHERE d2.id > d.id
        AND d2.account_id IS NOT DISTINCT FROM d.account_id
        AND d2.campaign_id IS NOT DISTINCT FROM d.campaign_id
        AND d2.campaign_date IS NOT DISTINCT FROM d.campaign_date
        AND d2.placement IS NOT DISTINCT FROM d.placement
        AND d2.country IS NOT DISTINCT FROM d.country
    );
  END IF;
END $$;

DROP INDEX IF EXISTS public.reddit_campaigns_ad_group_country_upsert_key;
CREATE UNIQUE INDEX reddit_campaigns_ad_group_country_upsert_key
  ON public.reddit_campaigns_ad_group_country (account_id, campaign_date, campaign_name, ad_group_name, country)
  NULLS NOT DISTINCT;

DROP INDEX IF EXISTS public.reddit_campaigns_placement_country_upsert_key;
CREATE UNIQUE INDEX reddit_campaigns_placement_country_upsert_key
  ON public.reddit_campaigns_placement_country (account_id, campaign_id, campaign_date, placement, country)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_reddit_ad_group_country_date
  ON public.reddit_campaigns_ad_group_country (campaign_date);
CREATE INDEX IF NOT EXISTS idx_reddit_ad_group_country_account
  ON public.reddit_campaigns_ad_group_country (account_id);
CREATE INDEX IF NOT EXISTS idx_reddit_ad_group_country_country
  ON public.reddit_campaigns_ad_group_country (country);
CREATE INDEX IF NOT EXISTS idx_reddit_placement_country_date
  ON public.reddit_campaigns_placement_country (campaign_date);
CREATE INDEX IF NOT EXISTS idx_reddit_placement_country_account
  ON public.reddit_campaigns_placement_country (account_id);
CREATE INDEX IF NOT EXISTS idx_reddit_placement_country_country
  ON public.reddit_campaigns_placement_country (country);

ALTER TABLE public.reddit_campaigns_ad_group_country ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated select reddit_campaigns_ad_group_country"
  ON public.reddit_campaigns_ad_group_country;
CREATE POLICY "Authenticated select reddit_campaigns_ad_group_country"
  ON public.reddit_campaigns_ad_group_country FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Service role all reddit_campaigns_ad_group_country"
  ON public.reddit_campaigns_ad_group_country;
CREATE POLICY "Service role all reddit_campaigns_ad_group_country"
  ON public.reddit_campaigns_ad_group_country FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.reddit_campaigns_placement_country ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated select reddit_campaigns_placement_country"
  ON public.reddit_campaigns_placement_country;
CREATE POLICY "Authenticated select reddit_campaigns_placement_country"
  ON public.reddit_campaigns_placement_country FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Service role all reddit_campaigns_placement_country"
  ON public.reddit_campaigns_placement_country;
CREATE POLICY "Service role all reddit_campaigns_placement_country"
  ON public.reddit_campaigns_placement_country FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.reddit_ads_sync_by_date_country (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  segment_date DATE NOT NULL,
  country TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, segment_date, country)
);
CREATE INDEX IF NOT EXISTS idx_reddit_ads_sync_by_date_country_d
  ON public.reddit_ads_sync_by_date_country (segment_date DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_ads_sync_by_date_country_country
  ON public.reddit_ads_sync_by_date_country (country);

ALTER TABLE public.reddit_ads_sync_by_date_country ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read reddit_ads_sync_by_date_country"
  ON public.reddit_ads_sync_by_date_country;
CREATE POLICY "Authenticated read reddit_ads_sync_by_date_country"
  ON public.reddit_ads_sync_by_date_country FOR SELECT TO authenticated USING (true);

-- Allow reddit_ads_country platform in ads_sync_by_date_log.
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
    'microsoft_ads'
  ));

-- Sequence reset helper (handles empty tables: sequence min value is 1).
CREATE OR REPLACE FUNCTION public.reset_reddit_ads_country_sequences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max bigint;
BEGIN
  SELECT MAX(id) INTO v_max FROM public.reddit_campaigns_ad_group_country;
  IF v_max IS NULL THEN
    PERFORM setval(pg_get_serial_sequence('public.reddit_campaigns_ad_group_country', 'id'), 1, false);
  ELSE
    PERFORM setval(pg_get_serial_sequence('public.reddit_campaigns_ad_group_country', 'id'), v_max, true);
  END IF;

  SELECT MAX(id) INTO v_max FROM public.reddit_campaigns_placement_country;
  IF v_max IS NULL THEN
    PERFORM setval(pg_get_serial_sequence('public.reddit_campaigns_placement_country', 'id'), 1, false);
  ELSE
    PERFORM setval(pg_get_serial_sequence('public.reddit_campaigns_placement_country', 'id'), v_max, true);
  END IF;
END;
$$;
