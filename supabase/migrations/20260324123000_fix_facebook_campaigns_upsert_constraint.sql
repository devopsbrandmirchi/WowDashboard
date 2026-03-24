-- Ensure facebook_campaigns_data supports upsert ON CONFLICT (account_id, ad_id, day).
-- Fixes: "there is no unique or exclusion constraint matching the ON CONFLICT specification"

DO $$
BEGIN
  IF to_regclass('public.facebook_campaigns_data') IS NULL THEN
    RETURN;
  END IF;

  -- Ensure required columns exist.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'facebook_campaigns_data' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE public.facebook_campaigns_data ADD COLUMN account_id VARCHAR(50);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'facebook_campaigns_data' AND column_name = 'ad_id'
  ) THEN
    ALTER TABLE public.facebook_campaigns_data ADD COLUMN ad_id VARCHAR(50);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'facebook_campaigns_data' AND column_name = 'day'
  ) THEN
    ALTER TABLE public.facebook_campaigns_data ADD COLUMN day DATE;
  END IF;

  -- Backfill any legacy null/blank keys.
  UPDATE public.facebook_campaigns_data
  SET day = reporting_starts
  WHERE day IS NULL AND reporting_starts IS NOT NULL;

  UPDATE public.facebook_campaigns_data
  SET day = (created_at AT TIME ZONE 'UTC')::date
  WHERE day IS NULL AND created_at IS NOT NULL;

  UPDATE public.facebook_campaigns_data
  SET ad_id = 'legacy_ad_' || id::text
  WHERE ad_id IS NULL OR BTRIM(COALESCE(ad_id::text, '')) = '';

  UPDATE public.facebook_campaigns_data
  SET account_id = COALESCE(NULLIF(BTRIM(account_id::text), ''), 'facebook_legacy')
  WHERE account_id IS NULL OR BTRIM(COALESCE(account_id::text, '')) = '';

  -- Deduplicate by upsert key, keep latest id.
  DELETE FROM public.facebook_campaigns_data d
  WHERE EXISTS (
    SELECT 1
    FROM public.facebook_campaigns_data d2
    WHERE d2.id > d.id
      AND d2.account_id IS NOT DISTINCT FROM d.account_id
      AND d2.ad_id IS NOT DISTINCT FROM d.ad_id
      AND d2.day IS NOT DISTINCT FROM d.day
  );

  -- Enforce exact uniqueness required by upsert onConflict.
  DROP INDEX IF EXISTS public.facebook_campaigns_data_upsert_ad_day;
  CREATE UNIQUE INDEX facebook_campaigns_data_upsert_ad_day
    ON public.facebook_campaigns_data (account_id, ad_id, day)
    NULLS NOT DISTINCT;
END $$;

