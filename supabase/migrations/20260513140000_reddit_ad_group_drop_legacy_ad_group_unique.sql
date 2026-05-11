-- Per-country ad group facts need multiple rows per ad group per day; legacy
-- ad_group_unique (pre-country) causes: duplicate key value violates unique constraint "ad_group_unique"
ALTER TABLE public.reddit_campaigns_ad_group
  DROP CONSTRAINT IF EXISTS ad_group_unique;
DROP INDEX IF EXISTS public.ad_group_unique;
