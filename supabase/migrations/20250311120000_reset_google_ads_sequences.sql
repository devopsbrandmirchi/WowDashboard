-- Reset identity sequences for Google Ads tables so INSERT never gets duplicate id.
-- Call this (or have the sync function call it) after DELETE and before INSERT.
CREATE OR REPLACE FUNCTION public.reset_google_ads_data_sequences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM setval(
    pg_get_serial_sequence('public.google_campaigns_data', 'id'),
    COALESCE((SELECT MAX(id) FROM public.google_campaigns_data), 0)
  );
  PERFORM setval(
    pg_get_serial_sequence('public.google_ad_groups_data', 'id'),
    COALESCE((SELECT MAX(id) FROM public.google_ad_groups_data), 0)
  );
  PERFORM setval(
    pg_get_serial_sequence('public.google_keywords_data', 'id'),
    COALESCE((SELECT MAX(id) FROM public.google_keywords_data), 0)
  );
END;
$$;
