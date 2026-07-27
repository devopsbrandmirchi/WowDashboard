-- Point daily Meta sync at fetch-facebook-campaigns-upsert (no JWT at gateway).
-- Legacy fetch-facebook-campaigns used delete-then-insert and verify_jwt=true, which
-- left facebook_campaigns_data empty for "yesterday" when the job failed auth/Graph.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $sched$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'facebook-campaigns-sync-daily') THEN
    PERFORM cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'facebook-campaigns-sync-daily' LIMIT 1));
  END IF;
END
$sched$;

-- 03:00 UTC — before daily-ad-spend-email at 07:00 UTC
SELECT cron.schedule(
  'facebook-campaigns-sync-daily',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
      || '/functions/v1/fetch-facebook-campaigns-upsert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_auth_key'),
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_apikey')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
