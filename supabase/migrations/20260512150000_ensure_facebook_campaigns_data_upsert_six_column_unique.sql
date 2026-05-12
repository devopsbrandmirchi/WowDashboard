-- Align facebook_campaigns_data with fetch-facebook-campaigns-upsert ON CONFLICT
-- (account_id, ad_id, day, platform, placement, device_platform).
-- Repairs DBs that never applied 20260405120000_facebook_campaigns_placement_unique_key.sql
-- and still have the older 3-column unique index only.
--
-- Dedupe uses DELETE ... USING + ROW_NUMBER() (one pass) instead of DELETE ... EXISTS
-- (nested-loop death on large tables). A staging btree index helps grouping/sort.
-- If the Supabase SQL Editor still times out, run this file via psql or `supabase db execute`
-- against the database directly (higher/no dashboard limit).

DO $$
BEGIN
  IF to_regclass('public.facebook_campaigns_data') IS NULL THEN
    RETURN;
  END IF;

  -- Avoid aborting mid-migration on large installs (dashboard may still enforce its own cap).
  PERFORM set_config('statement_timeout', '0', true);

  ALTER TABLE public.facebook_campaigns_data
    DROP CONSTRAINT IF EXISTS facebook_unique_insight;

  DROP INDEX IF EXISTS public.facebook_campaigns_data_upsert_ad_day;

  DROP INDEX IF EXISTS public.facebook_campaigns_data_dedupe_stage;

  CREATE INDEX facebook_campaigns_data_dedupe_stage
    ON public.facebook_campaigns_data (account_id, ad_id, day, platform, placement, device_platform);

  DELETE FROM public.facebook_campaigns_data AS d
  USING (
    SELECT id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY account_id, ad_id, day, platform, placement, device_platform
          ORDER BY id DESC
        ) AS rn
      FROM public.facebook_campaigns_data
    ) AS ranked
    WHERE ranked.rn > 1
  ) AS doomed
  WHERE d.id = doomed.id;

  DROP INDEX IF EXISTS public.facebook_campaigns_data_dedupe_stage;

  CREATE UNIQUE INDEX facebook_campaigns_data_upsert_ad_day
    ON public.facebook_campaigns_data (account_id, ad_id, day, platform, placement, device_platform)
    NULLS NOT DISTINCT;
END $$;
