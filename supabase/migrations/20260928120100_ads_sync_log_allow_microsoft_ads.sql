-- 20260519120000_drop_ads_country_sync.sql re-created this check without microsoft_ads,
-- so every Microsoft Ads sync-log insert has been rejected since then.
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
