-- Create duplicate Google Ads tables for country-aware sync.
-- This migration does not modify existing google_* tables/functions.

CREATE TABLE IF NOT EXISTS public.google_campaigns_data_country
(LIKE public.google_campaigns_data INCLUDING ALL);

CREATE TABLE IF NOT EXISTS public.google_ad_groups_data_country
(LIKE public.google_ad_groups_data INCLUDING ALL);

CREATE TABLE IF NOT EXISTS public.google_keywords_data_country
(LIKE public.google_keywords_data INCLUDING ALL);

ALTER TABLE public.google_campaigns_data_country
ADD COLUMN IF NOT EXISTS country TEXT;

CREATE OR REPLACE FUNCTION public.reset_google_ads_data_country_sequences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM setval(
    pg_get_serial_sequence('public.google_campaigns_data_country', 'id'),
    COALESCE((SELECT MAX(id) FROM public.google_campaigns_data_country), 0)
  );

  PERFORM setval(
    pg_get_serial_sequence('public.google_ad_groups_data_country', 'id'),
    COALESCE((SELECT MAX(id) FROM public.google_ad_groups_data_country), 0)
  );

  PERFORM setval(
    pg_get_serial_sequence('public.google_keywords_data_country', 'id'),
    COALESCE((SELECT MAX(id) FROM public.google_keywords_data_country), 0)
  );
END;
$$;
