-- Schedule Microsoft Ads sync Edge Function via pg_cron + pg_net.
-- Prerequisites:
--   1. Deploy sync-microsoft-ads Edge Function and set secrets:
--        MS_ADS_TENANT_ID, MS_ADS_CLIENT_ID, MS_ADS_CLIENT_SECRET,
--        MS_ADS_DEVELOPER_TOKEN, MS_ADS_CUSTOMER_ID, MS_ADS_ACCOUNT_ID
--   2. Vault secrets (Dashboard → SQL or Vault):
--        project_url            = 'https://icyrctjdskdezbtcoaez.supabase.co'
--        edge_function_auth_key  = anon JWT (Bearer token)
--        edge_function_apikey    = anon apikey

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Run Microsoft Ads sync daily at 05:00 UTC (after Reddit at 04:00)
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
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
