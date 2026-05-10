-- Country on ad-group facts (Reddit): Reddit Country tab aggregates from
-- reddit_campaigns_ad_group directly (no join to reddit_campaigns_reference_data).
-- Country is part of the row identity because the Reddit Ads API report is now
-- broken down by COUNTRY (one row per campaign x ad_group x country x day).

-- 1. Add country column.
ALTER TABLE public.reddit_campaigns_ad_group
  ADD COLUMN IF NOT EXISTS country character varying(255) NULL;

-- 2. Drop the legacy unique constraint (it didn't include account_id and
--    is fully superseded by reddit_campaigns_ad_group_upsert_key below).
ALTER TABLE public.reddit_campaigns_ad_group
  DROP CONSTRAINT IF EXISTS ad_group_unique;

-- 3. Replace the upsert key index with one that includes country.
--    NULLS NOT DISTINCT keeps pre-migration NULL-country rows valid until they
--    are overwritten by the next sync.
DROP INDEX IF EXISTS public.reddit_campaigns_ad_group_upsert_key;

CREATE UNIQUE INDEX IF NOT EXISTS reddit_campaigns_ad_group_upsert_key
  ON public.reddit_campaigns_ad_group (
    account_id,
    campaign_date,
    campaign_name,
    ad_group_name,
    country
  ) NULLS NOT DISTINCT;

-- 4. Country lookup index for the Country tab.
CREATE INDEX IF NOT EXISTS idx_reddit_ad_group_country
  ON public.reddit_campaigns_ad_group (country);

-- Note: existing pre-migration rows have country = NULL. The next run of
-- fetch-reddit-campaigns-upsert deletes NULL-country rows inside its synced
-- date range before upserting, so resyncing over the full historical range
-- (POST { date_from, date_to }) cleanly migrates the data with no double-count.
