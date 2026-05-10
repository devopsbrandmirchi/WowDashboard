-- Denormalized campaign country on performance rows (from Meta country breakdown at sync time).
-- Enables Meta report Country tab to aggregate from facebook_campaigns_data without joining reference.

DO $$
BEGIN
  IF to_regclass('public.facebook_campaigns_data') IS NULL THEN
    RAISE NOTICE 'facebook_campaigns_data missing; skip country column';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'facebook_campaigns_data' AND column_name = 'country'
  ) THEN
    ALTER TABLE public.facebook_campaigns_data ADD COLUMN country character varying(100) NULL;
  END IF;
END $$;
