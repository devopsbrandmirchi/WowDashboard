-- Allow one row per (account, ad, day, publisher platform, placement position, device).
-- Required when syncing insights with breakdowns publisher_platform + platform_position.

DO $$
BEGIN
  IF to_regclass('public.facebook_campaigns_data') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.facebook_campaigns_data
    DROP CONSTRAINT IF EXISTS facebook_unique_insight;

  DROP INDEX IF EXISTS public.facebook_campaigns_data_upsert_ad_day;

  DELETE FROM public.facebook_campaigns_data d
  WHERE EXISTS (
    SELECT 1
    FROM public.facebook_campaigns_data d2
    WHERE d2.id > d.id
      AND d2.account_id IS NOT DISTINCT FROM d.account_id
      AND d2.ad_id IS NOT DISTINCT FROM d.ad_id
      AND d2.day IS NOT DISTINCT FROM d.day
      AND d2.platform IS NOT DISTINCT FROM d.platform
      AND d2.placement IS NOT DISTINCT FROM d.placement
      AND d2.device_platform IS NOT DISTINCT FROM d.device_platform
  );

  CREATE UNIQUE INDEX facebook_campaigns_data_upsert_ad_day
    ON public.facebook_campaigns_data (account_id, ad_id, day, platform, placement, device_platform)
    NULLS NOT DISTINCT;
END $$;
