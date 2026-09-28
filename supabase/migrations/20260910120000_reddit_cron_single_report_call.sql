-- Reddit daily cron: one reports API call per day (ad-group only).
-- Placement refresh is opt-in via include_placement=true (Settings manual sync).
-- Also raise pg_net timeout so multi-day backfills are less likely to time out.

SELECT cron.unschedule('reddit-campaigns-sync-daily');

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
    body := '{"include_placement":false}'::jsonb,
    timeout_milliseconds := 300000
  ) AS request_id;
  $$
);
