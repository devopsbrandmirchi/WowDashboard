-- Align reddit_campaigns_ad_group with fetch-reddit-campaigns-upsert onConflict:
--   (account_id, campaign_date, campaign_name, ad_group_name, country)
-- Fixes: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- when the DB still has the legacy 4-column unique index from 20250318200000.

DO $$
BEGIN
  IF to_regclass('public.reddit_campaigns_ad_group') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.reddit_campaigns_ad_group
    ADD COLUMN IF NOT EXISTS country character varying(255) NULL;

  -- Legacy key (often campaign_date + names without country) blocks multiple country rows.
  ALTER TABLE public.reddit_campaigns_ad_group
    DROP CONSTRAINT IF EXISTS ad_group_unique;
  DROP INDEX IF EXISTS public.ad_group_unique;

  DELETE FROM public.reddit_campaigns_ad_group d
  WHERE EXISTS (
    SELECT 1
    FROM public.reddit_campaigns_ad_group d2
    WHERE d2.id > d.id
      AND d2.account_id IS NOT DISTINCT FROM d.account_id
      AND d2.campaign_date IS NOT DISTINCT FROM d.campaign_date
      AND d2.campaign_name IS NOT DISTINCT FROM d.campaign_name
      AND d2.ad_group_name IS NOT DISTINCT FROM d.ad_group_name
      AND d2.country IS NOT DISTINCT FROM d.country
  );

  DROP INDEX IF EXISTS public.reddit_campaigns_ad_group_upsert_key;

  CREATE UNIQUE INDEX reddit_campaigns_ad_group_upsert_key
    ON public.reddit_campaigns_ad_group (
      account_id,
      campaign_date,
      campaign_name,
      ad_group_name,
      country
    )
    NULLS NOT DISTINCT;
END $$;
