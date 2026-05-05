-- Yesterday spend totals per platform (USD) for daily email digest.
-- Used by Edge Function send-daily-ad-spend-email via RPC (service_role).

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
  'Returns JSON spend totals (USD) per ad platform for one calendar date. Reddit/Microsoft: sum amount_spent_usd on ad_group tables only (avoids placement double-count; total_spent not assumed).';

REVOKE ALL ON FUNCTION public.get_daily_platform_spend_usd(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_platform_spend_usd(date) TO service_role;

-- Daily email after ad sync crons (Microsoft 05:00 UTC → digest 07:00 UTC).
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $sched$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-ad-spend-email') THEN
    PERFORM cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'daily-ad-spend-email'));
  END IF;
END
$sched$;

SELECT cron.schedule(
  'daily-ad-spend-email',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/send-daily-ad-spend-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_auth_key'),
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_apikey')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
