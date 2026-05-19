-- Roll back country-specific sync schema (edge functions removed separately).
-- Keeps reddit_campaigns_ad_group.country for fetch-reddit-campaigns-upsert.

-- Dedicated country sync tables
DROP TABLE IF EXISTS public.google_campaigns_data_country CASCADE;
DROP TABLE IF EXISTS public.google_ad_groups_data_country CASCADE;
DROP TABLE IF EXISTS public.google_keywords_data_country CASCADE;

DROP TABLE IF EXISTS public.facebook_campaigns_data_country CASCADE;
DROP TABLE IF EXISTS public.facebook_ads_sync_by_date_country CASCADE;

DROP TABLE IF EXISTS public.reddit_campaigns_ad_group_country CASCADE;
DROP TABLE IF EXISTS public.reddit_campaigns_placement_country CASCADE;
DROP TABLE IF EXISTS public.reddit_ads_sync_by_date_country CASCADE;

DROP TABLE IF EXISTS public.tiktok_campaigns_data_country CASCADE;
DROP TABLE IF EXISTS public.tiktok_ads_sync_by_date_country CASCADE;

DROP TABLE IF EXISTS public.microsoft_campaigns_ad_group_country CASCADE;
DROP TABLE IF EXISTS public.microsoft_campaigns_placement_country CASCADE;
DROP TABLE IF EXISTS public.microsoft_ads_sync_by_date_country CASCADE;

-- Country sync RPC helpers
DROP FUNCTION IF EXISTS public.reset_google_ads_data_country_sequences();
DROP FUNCTION IF EXISTS public.reset_facebook_campaigns_data_country_sequence();
DROP FUNCTION IF EXISTS public.reset_reddit_ads_country_sequences();
DROP FUNCTION IF EXISTS public.reset_tiktok_campaigns_data_country_sequence();

-- Sync log cleanup
DELETE FROM public.ads_sync_by_date_log
WHERE platform IN (
  'google_ads_country',
  'reddit_ads_country',
  'facebook_ads_country',
  'tiktok_ads_country',
  'microsoft_ads_country'
);

ALTER TABLE public.ads_sync_by_date_log
  DROP CONSTRAINT IF EXISTS ads_sync_by_date_log_platform_check;

ALTER TABLE public.ads_sync_by_date_log
  ADD CONSTRAINT ads_sync_by_date_log_platform_check CHECK (platform IN (
    'google_ads',
    'reddit_ads',
    'facebook_ads',
    'tiktok_ads',
    'microsoft_ads'
  ));

-- Main-table country columns added only for country sync feature
ALTER TABLE public.facebook_campaigns_data
  DROP COLUMN IF EXISTS country;

DROP INDEX IF EXISTS public.idx_microsoft_ad_group_country;
ALTER TABLE public.microsoft_campaigns_ad_group
  DROP COLUMN IF EXISTS country;
