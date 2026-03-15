-- Fix cron so it calls the same URL and headers as the working curl (data inserts).
-- Vault secrets (create in Dashboard → SQL or Vault):
--   project_url           = 'https://icyrctjdskdezbtcoaez.supabase.co'
--   edge_function_auth_key = your anon JWT (Authorization Bearer value from curl)
--   edge_function_apikey   = your anon apikey (apikey value from curl, e.g. sb_publishable_...)

SELECT cron.unschedule('google-ads-sync-daily');

SELECT cron.schedule(
  'google-ads-sync-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/sync-google-ads-data-Edge',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_auth_key'),
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_apikey')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
