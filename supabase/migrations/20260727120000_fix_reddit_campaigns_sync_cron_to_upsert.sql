-- Point daily Reddit sync at fetch-reddit-campaigns-upsert (no JWT at gateway).
-- Legacy fetch-reddit-campaigns used delete-then-insert and verify_jwt=true, which
-- left reddit_campaigns_ad_group empty when the job failed auth/API.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $sched$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reddit-campaigns-sync-daily') THEN
    PERFORM cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'reddit-campaigns-sync-daily' LIMIT 1));
  END IF;
END
$sched$;

-- 04:00 UTC — after Facebook at 03:00, before daily-ad-spend-email at 07:00 UTC
SELECT cron.schedule(
  'reddit-campaigns-sync-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
      || '/functions/v1/fetch-reddit-campaigns-upsert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_auth_key'),
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_apikey')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
