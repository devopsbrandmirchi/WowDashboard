-- Realign facebook_campaigns_data id identity after restores / manual inserts so INSERT never reuses an existing id.
-- Call from fetch-facebook-campaigns (and upsert variant) before writing rows.
CREATE OR REPLACE FUNCTION public.reset_facebook_campaigns_data_sequence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.facebook_campaigns_data') IS NULL THEN
    RETURN;
  END IF;
  PERFORM setval(
    pg_get_serial_sequence('public.facebook_campaigns_data', 'id'),
    COALESCE((SELECT MAX(id) FROM public.facebook_campaigns_data), 0)
  );
END;
$$;
