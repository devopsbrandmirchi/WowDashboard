-- Reddit Ads: sync-by-date table + upsert unique keys (PG 15+ NULLS NOT DISTINCT).
-- Skips safely if reddit data tables are missing; adds account_id when needed.

CREATE TABLE IF NOT EXISTS public.reddit_ads_sync_by_date (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  segment_date DATE NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, segment_date)
);
CREATE INDEX IF NOT EXISTS idx_reddit_ads_sync_by_date_d ON public.reddit_ads_sync_by_date (segment_date DESC);
ALTER TABLE public.reddit_ads_sync_by_date ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read reddit_ads_sync_by_date" ON public.reddit_ads_sync_by_date;
CREATE POLICY "Authenticated read reddit_ads_sync_by_date"
  ON public.reddit_ads_sync_by_date FOR SELECT TO authenticated USING (true);

DO $$
BEGIN
  IF to_regclass('public.reddit_campaigns_ad_group') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'reddit_campaigns_ad_group' AND column_name = 'account_id'
    ) THEN
      ALTER TABLE public.reddit_campaigns_ad_group ADD COLUMN account_id VARCHAR(50);
    END IF;
  END IF;
  IF to_regclass('public.reddit_campaigns_placement') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'reddit_campaigns_placement' AND column_name = 'account_id'
    ) THEN
      ALTER TABLE public.reddit_campaigns_placement ADD COLUMN account_id VARCHAR(50);
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.reddit_campaigns_ad_group') IS NOT NULL THEN
    UPDATE public.reddit_campaigns_ad_group SET account_id = COALESCE(NULLIF(BTRIM(account_id::text), ''), 'reddit_legacy')
    WHERE account_id IS NULL OR BTRIM(COALESCE(account_id::text, '')) = '';
  END IF;
  IF to_regclass('public.reddit_campaigns_placement') IS NOT NULL THEN
    UPDATE public.reddit_campaigns_placement SET account_id = COALESCE(NULLIF(BTRIM(account_id::text), ''), 'reddit_legacy')
    WHERE account_id IS NULL OR BTRIM(COALESCE(account_id::text, '')) = '';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.reddit_campaigns_placement') IS NOT NULL THEN
    ALTER TABLE public.reddit_campaigns_placement ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(100);
    UPDATE public.reddit_campaigns_placement SET campaign_id = COALESCE(NULLIF(BTRIM(campaign_id::text), ''), 'legacy_' || id::text)
    WHERE campaign_id IS NULL OR BTRIM(COALESCE(campaign_id::text, '')) = '';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.reddit_campaigns_ad_group') IS NOT NULL THEN
    DELETE FROM public.reddit_campaigns_ad_group d
    WHERE EXISTS (
      SELECT 1 FROM public.reddit_campaigns_ad_group d2
      WHERE d2.id > d.id
        AND d2.account_id IS NOT DISTINCT FROM d.account_id
        AND d2.campaign_date IS NOT DISTINCT FROM d.campaign_date
        AND d2.campaign_name IS NOT DISTINCT FROM d.campaign_name
        AND d2.ad_group_name IS NOT DISTINCT FROM d.ad_group_name
    );
  END IF;
  IF to_regclass('public.reddit_campaigns_placement') IS NOT NULL THEN
    DELETE FROM public.reddit_campaigns_placement d
    WHERE EXISTS (
      SELECT 1 FROM public.reddit_campaigns_placement d2
      WHERE d2.id > d.id
        AND d2.account_id IS NOT DISTINCT FROM d.account_id
        AND d2.campaign_id IS NOT DISTINCT FROM d.campaign_id
        AND d2.campaign_date IS NOT DISTINCT FROM d.campaign_date
        AND d2.placement IS NOT DISTINCT FROM d.placement
    );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.reddit_campaigns_ad_group') IS NOT NULL THEN
    DROP INDEX IF EXISTS public.reddit_campaigns_ad_group_upsert_key;
    CREATE UNIQUE INDEX reddit_campaigns_ad_group_upsert_key
      ON public.reddit_campaigns_ad_group (account_id, campaign_date, campaign_name, ad_group_name)
      NULLS NOT DISTINCT;
  END IF;
  IF to_regclass('public.reddit_campaigns_placement') IS NOT NULL THEN
    DROP INDEX IF EXISTS public.reddit_campaigns_placement_upsert_key;
    CREATE UNIQUE INDEX reddit_campaigns_placement_upsert_key
      ON public.reddit_campaigns_placement (account_id, campaign_id, campaign_date, placement)
      NULLS NOT DISTINCT;
  END IF;
END $$;
