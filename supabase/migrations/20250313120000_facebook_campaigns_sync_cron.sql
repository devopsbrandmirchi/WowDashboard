-- Schedule Facebook/Meta Ads campaign sync Edge Function via pg_cron + pg_net.
-- Prerequisites:
--   1. Deploy fetch-facebook-campaigns Edge Function and set secrets (FB_APP_ID, FB_APP_SECRET, FB_ACCESS_TOKEN, FB_ACCOUNT_ID).
--   2. Vault secrets (Dashboard → SQL or Vault):
--        project_url           = 'https://YOUR_PROJECT_REF.supabase.co'
--        edge_function_auth_key = anon JWT (Bearer token from working curl)
--        edge_function_apikey   = anon apikey (apikey header from working curl)

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Run Facebook campaigns sync daily at 03:00 UTC (after Google Ads at 02:00)
SELECT cron.schedule(
  'facebook-campaigns-sync-daily',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/fetch-facebook-campaigns',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_auth_key'),
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_apikey')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
