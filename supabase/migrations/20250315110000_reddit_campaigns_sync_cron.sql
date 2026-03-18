-- Schedule Reddit Ads campaign sync Edge Function via pg_cron + pg_net.
-- Prerequisites:
--   1. Deploy fetch-reddit-campaigns Edge Function and set secrets (REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN, REDDIT_ACCOUNT_ID).
--   2. Vault secrets (Dashboard → SQL or Vault):
--        project_url            = 'https://YOUR_PROJECT_REF.supabase.co'
--        edge_function_auth_key  = anon JWT (Bearer token)
--        edge_function_apikey    = anon apikey

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Run Reddit campaigns sync daily at 04:00 UTC (after Facebook at 03:00)
SELECT cron.schedule(
  'reddit-campaigns-sync-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/fetch-reddit-campaigns',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_auth_key'),
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_apikey')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
