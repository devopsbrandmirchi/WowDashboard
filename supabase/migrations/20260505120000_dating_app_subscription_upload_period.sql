-- Store report calendar month/year parsed from sheet tab / title at upload time.

ALTER TABLE public.dating_app_subscription_uploads
  ADD COLUMN IF NOT EXISTS report_year smallint,
  ADD COLUMN IF NOT EXISTS report_month smallint;

ALTER TABLE public.dating_app_subscription_uploads
  DROP CONSTRAINT IF EXISTS dating_app_subscription_uploads_report_month_range;

ALTER TABLE public.dating_app_subscription_uploads
  ADD CONSTRAINT dating_app_subscription_uploads_report_month_range
  CHECK (report_month IS NULL OR (report_month >= 1 AND report_month <= 12));

CREATE INDEX IF NOT EXISTS idx_dating_app_subscription_uploads_period
  ON public.dating_app_subscription_uploads (report_year DESC, report_month DESC);
