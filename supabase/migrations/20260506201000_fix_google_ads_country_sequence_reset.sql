-- Fix sequence reset for empty *_country tables.
-- setval(..., 0) is invalid for sequences with min value 1.

CREATE OR REPLACE FUNCTION public.reset_google_ads_data_country_sequences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max bigint;
BEGIN
  SELECT MAX(id) INTO v_max FROM public.google_campaigns_data_country;
  IF v_max IS NULL THEN
    PERFORM setval(pg_get_serial_sequence('public.google_campaigns_data_country', 'id'), 1, false);
  ELSE
    PERFORM setval(pg_get_serial_sequence('public.google_campaigns_data_country', 'id'), v_max, true);
  END IF;

  SELECT MAX(id) INTO v_max FROM public.google_ad_groups_data_country;
  IF v_max IS NULL THEN
    PERFORM setval(pg_get_serial_sequence('public.google_ad_groups_data_country', 'id'), 1, false);
  ELSE
    PERFORM setval(pg_get_serial_sequence('public.google_ad_groups_data_country', 'id'), v_max, true);
  END IF;

  SELECT MAX(id) INTO v_max FROM public.google_keywords_data_country;
  IF v_max IS NULL THEN
    PERFORM setval(pg_get_serial_sequence('public.google_keywords_data_country', 'id'), 1, false);
  ELSE
    PERFORM setval(pg_get_serial_sequence('public.google_keywords_data_country', 'id'), v_max, true);
  END IF;
END;
$$;
