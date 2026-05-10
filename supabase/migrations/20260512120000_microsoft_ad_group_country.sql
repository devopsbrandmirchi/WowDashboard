-- Country on ad-group facts (Bing/Microsoft): filled by sync-microsoft-ads from geographic report.
ALTER TABLE public.microsoft_campaigns_ad_group
  ADD COLUMN IF NOT EXISTS country character varying(255) NULL;

CREATE INDEX IF NOT EXISTS idx_microsoft_ad_group_country
  ON public.microsoft_campaigns_ad_group (country);
