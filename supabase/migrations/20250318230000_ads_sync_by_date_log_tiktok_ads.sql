-- Allow tiktok_ads in ads_sync_by_date_log (for DBs that already ran 20250318210000 without it).
ALTER TABLE public.ads_sync_by_date_log
  DROP CONSTRAINT IF EXISTS ads_sync_by_date_log_platform_check;

ALTER TABLE public.ads_sync_by_date_log
  ADD CONSTRAINT ads_sync_by_date_log_platform_check CHECK (platform IN (
    'google_ads', 'reddit_ads', 'facebook_ads', 'tiktok_ads'
  ));
