-- Fix id sequence for google_campaigns_reference_data (one-time sync).
SELECT setval(
  pg_get_serial_sequence('public.google_campaigns_reference_data', 'id'),
  COALESCE((SELECT MAX(id) FROM public.google_campaigns_reference_data), 0)
);

-- Include reference table in reset function so sync never hits duplicate id.
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
    pg_get_serial_sequence('public.google_campaigns_reference_data', 'id'),
    COALESCE((SELECT MAX(id) FROM public.google_campaigns_reference_data), 0)
  );
END;
$$;
