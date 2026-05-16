-- Fix Meta Edge upsert errors:
-- 1) reset_facebook_campaigns_data_sequence used COALESCE(MAX(id),0) → setval(..., 0) which Postgres rejects (sequence min 1).
-- 2) facebook_campaigns_data missing UNIQUE on (account_id, ad_id, day, platform, placement, device_platform)
--    causes "there is no unique or exclusion constraint matching the ON CONFLICT specification".
--
-- Idempotent: safe if 20260405120000 / 20260512150000 already ran.

CREATE OR REPLACE FUNCTION public.reset_facebook_campaigns_data_sequence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max bigint;
  seq_name text;
BEGIN
  IF to_regclass('public.facebook_campaigns_data') IS NULL THEN
    RETURN;
  END IF;
  seq_name := pg_get_serial_sequence('public.facebook_campaigns_data', 'id');
  IF seq_name IS NULL THEN
    RETURN;
  END IF;

  SELECT MAX(id) INTO v_max FROM public.facebook_campaigns_data;
  IF v_max IS NULL THEN
    PERFORM setval(seq_name::regclass, 1, false);
  ELSE
    PERFORM setval(seq_name::regclass, v_max, true);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_facebook_campaigns_reference_sequence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max bigint;
  seq_name text;
BEGIN
  IF to_regclass('public.facebook_campaigns_reference_data') IS NULL THEN
    RETURN;
  END IF;
  seq_name := pg_get_serial_sequence('public.facebook_campaigns_reference_data', 'id');
  IF seq_name IS NULL THEN
    RETURN;
  END IF;

  SELECT MAX(id) INTO v_max FROM public.facebook_campaigns_reference_data;
  IF v_max IS NULL THEN
    PERFORM setval(seq_name::regclass, 1, false);
  ELSE
    PERFORM setval(seq_name::regclass, v_max, true);
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.facebook_campaigns_data') IS NULL THEN
    RETURN;
  END IF;

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
