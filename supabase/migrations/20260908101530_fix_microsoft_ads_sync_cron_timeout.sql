-- Microsoft Ads sync regularly exceeds pg_net's default 5s HTTP timeout
-- (report submit + poll often takes 20–120s). Cron then records a timeout and
-- the day's rows can be missing. Raise timeout to 5 minutes.

SELECT cron.unschedule('microsoft-ads-sync-daily');

SELECT cron.schedule(
  'microsoft-ads-sync-daily',
  '0 5 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/sync-microsoft-ads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_auth_key'),
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_apikey')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  ) AS request_id;
  $$
);
