-- Reset identity sequence for facebook_campaigns_reference_data so INSERT never gets duplicate id.
-- Call from fetch-facebook-campaigns before inserting new campaign names.
CREATE OR REPLACE FUNCTION public.reset_facebook_campaigns_reference_sequence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM setval(
    pg_get_serial_sequence('public.facebook_campaigns_reference_data', 'id'),
    COALESCE((SELECT MAX(id) FROM public.facebook_campaigns_reference_data), 0)
  );
END;
$$;
