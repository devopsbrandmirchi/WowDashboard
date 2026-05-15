-- Fix: allow facebook_ads_country platform in ads_sync_by_date_log
-- Fix: sequence reset for facebook_campaigns_data_country cannot set 0 (sequence min is 1)

ALTER TABLE public.ads_sync_by_date_log
  DROP CONSTRAINT IF EXISTS ads_sync_by_date_log_platform_check;

ALTER TABLE public.ads_sync_by_date_log
  ADD CONSTRAINT ads_sync_by_date_log_platform_check CHECK (platform IN (
    'google_ads',
    'google_ads_country',
    'reddit_ads',
    'facebook_ads',
    'facebook_ads_country',
    'tiktok_ads',
    'microsoft_ads'
  ));

CREATE OR REPLACE FUNCTION public.reset_facebook_campaigns_data_country_sequence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_val bigint;
BEGIN
  SELECT COALESCE(MAX(id), 0) INTO next_val
  FROM public.facebook_campaigns_data_country;

  IF next_val < 1 THEN
    next_val := 1;
  END IF;

  PERFORM setval(
    pg_get_serial_sequence('public.facebook_campaigns_data_country', 'id'),
    next_val
  );
END;
$$;

