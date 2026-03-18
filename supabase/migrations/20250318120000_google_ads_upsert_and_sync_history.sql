-- Google Ads: upsert keys + sync history (last sync time per customer + date).
-- Requires PostgreSQL 15+ (NULLS NOT DISTINCT). Run after google_*_data tables exist.

-- ---------------------------------------------------------------------------
-- 1) Sync history: one row per customer + calendar day (updated on each sync)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.google_ads_sync_by_date (
  id BIGSERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL,
  segment_date DATE NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, segment_date)
);

CREATE INDEX IF NOT EXISTS idx_google_ads_sync_by_date_segment ON public.google_ads_sync_by_date (segment_date DESC);

ALTER TABLE public.google_ads_sync_by_date ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read google_ads_sync_by_date" ON public.google_ads_sync_by_date;
CREATE POLICY "Authenticated read google_ads_sync_by_date"
  ON public.google_ads_sync_by_date FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.google_ads_sync_by_date IS 'Last successful Google Ads sync timestamp per customer account and report date.';

-- ---------------------------------------------------------------------------
-- 2) Ad groups / keywords: customer_id for unique keys across MCC clients
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'google_ad_groups_data') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'google_ad_groups_data' AND column_name = 'customer_id'
    ) THEN
      ALTER TABLE public.google_ad_groups_data ADD COLUMN customer_id TEXT;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'google_keywords_data') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'google_keywords_data' AND column_name = 'customer_id'
    ) THEN
      ALTER TABLE public.google_keywords_data ADD COLUMN customer_id TEXT;
    END IF;
  END IF;
END $$;

-- Backfill customer_id from campaigns (best effort)
UPDATE public.google_ad_groups_data ag
SET customer_id = sub.cid
FROM (
  SELECT DISTINCT ON (campaign_id) campaign_id, customer_id::text AS cid
  FROM public.google_campaigns_data
  ORDER BY campaign_id, segment_date DESC NULLS LAST
) sub
WHERE ag.customer_id IS NULL AND ag.campaign_id = sub.campaign_id;

UPDATE public.google_keywords_data kw
SET customer_id = sub.cid
FROM (
  SELECT DISTINCT ON (campaign_id) campaign_id, customer_id::text AS cid
  FROM public.google_campaigns_data
  ORDER BY campaign_id, segment_date DESC NULLS LAST
) sub
WHERE kw.customer_id IS NULL AND kw.campaign_id = sub.campaign_id;

UPDATE public.google_ad_groups_data SET customer_id = 'unknown' WHERE customer_id IS NULL;
UPDATE public.google_keywords_data SET customer_id = 'unknown' WHERE customer_id IS NULL;

-- Dedupe before unique indexes (keep largest id)
DELETE FROM public.google_campaigns_data d
WHERE EXISTS (
  SELECT 1 FROM public.google_campaigns_data d2
  WHERE d2.id > d.id
    AND d2.customer_id IS NOT DISTINCT FROM d.customer_id
    AND d2.campaign_id IS NOT DISTINCT FROM d.campaign_id
    AND d2.segment_date IS NOT DISTINCT FROM d.segment_date
    AND d2.network_type IS NOT DISTINCT FROM d.network_type
);

DELETE FROM public.google_ad_groups_data d
WHERE EXISTS (
  SELECT 1 FROM public.google_ad_groups_data d2
  WHERE d2.id > d.id
    AND d2.customer_id IS NOT DISTINCT FROM d.customer_id
    AND d2.campaign_id IS NOT DISTINCT FROM d.campaign_id
    AND d2.ad_group_id IS NOT DISTINCT FROM d.ad_group_id
    AND d2.segment_date IS NOT DISTINCT FROM d.segment_date
);

DELETE FROM public.google_keywords_data d
WHERE EXISTS (
  SELECT 1 FROM public.google_keywords_data d2
  WHERE d2.id > d.id
    AND d2.customer_id IS NOT DISTINCT FROM d.customer_id
    AND d2.campaign_id IS NOT DISTINCT FROM d.campaign_id
    AND d2.ad_group_id IS NOT DISTINCT FROM d.ad_group_id
    AND d2.criterion_id IS NOT DISTINCT FROM d.criterion_id
    AND d2.segment_date IS NOT DISTINCT FROM d.segment_date
);

-- Unique indexes for upsert (PostgreSQL 15+)
DROP INDEX IF EXISTS public.google_campaigns_data_upsert_key;
CREATE UNIQUE INDEX google_campaigns_data_upsert_key
  ON public.google_campaigns_data (customer_id, campaign_id, segment_date, network_type)
  NULLS NOT DISTINCT;

DROP INDEX IF EXISTS public.google_ad_groups_data_upsert_key;
CREATE UNIQUE INDEX google_ad_groups_data_upsert_key
  ON public.google_ad_groups_data (customer_id, campaign_id, ad_group_id, segment_date)
  NULLS NOT DISTINCT;

DROP INDEX IF EXISTS public.google_keywords_data_upsert_key;
CREATE UNIQUE INDEX google_keywords_data_upsert_key
  ON public.google_keywords_data (customer_id, campaign_id, ad_group_id, criterion_id, segment_date)
  NULLS NOT DISTINCT;
