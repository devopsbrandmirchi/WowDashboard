-- Some projects never had total_spent on reddit/microsoft ad_group tables.
-- Redefine RPC to use amount_spent_usd only (matches older / minimal schemas).

CREATE OR REPLACE FUNCTION public.get_daily_platform_spend_usd(p_report_date date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'report_date', p_report_date,
    'google_ads', COALESCE((
      SELECT SUM((g.cost_micros::numeric) / 1000000.0)
      FROM public.google_campaigns_data g
      WHERE g.segment_date = p_report_date
    ), 0),
    'meta_ads', COALESCE((
      SELECT SUM(f.amount_spent_usd::numeric)
      FROM public.facebook_campaigns_data f
      WHERE f.day = p_report_date
    ), 0),
    'reddit_ads', COALESCE((
      SELECT SUM(COALESCE(r.amount_spent_usd, 0)::numeric)
      FROM public.reddit_campaigns_ad_group r
      WHERE r.campaign_date = p_report_date
    ), 0),
    'microsoft_ads', COALESCE((
      SELECT SUM(COALESCE(m.amount_spent_usd, 0)::numeric)
      FROM public.microsoft_campaigns_ad_group m
      WHERE m.campaign_date = p_report_date
    ), 0),
    'tiktok_ads', COALESCE((
      SELECT SUM(t.cost::numeric)
      FROM public.tiktok_campaigns_data t
      WHERE t.date = p_report_date
    ), 0)
  );
$$;

COMMENT ON FUNCTION public.get_daily_platform_spend_usd(date) IS
  'Returns JSON spend totals (USD) per ad platform for one calendar date; Reddit/Microsoft use amount_spent_usd on ad_group tables only.';
