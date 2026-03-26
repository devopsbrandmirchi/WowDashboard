-- Ensure reddit_campaigns_ad_group has expected ID columns for REST schema cache consistency.
DO $$
BEGIN
  IF to_regclass('public.reddit_campaigns_ad_group') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'reddit_campaigns_ad_group'
        AND column_name = 'campaign_id'
    ) THEN
      ALTER TABLE public.reddit_campaigns_ad_group
        ADD COLUMN campaign_id VARCHAR(100);
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'reddit_campaigns_ad_group'
        AND column_name = 'ad_group_id'
    ) THEN
      ALTER TABLE public.reddit_campaigns_ad_group
        ADD COLUMN ad_group_id VARCHAR(100);
    END IF;
  END IF;
END $$;
