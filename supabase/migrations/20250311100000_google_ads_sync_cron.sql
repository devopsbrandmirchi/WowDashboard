-- Schedule Google Ads data sync Edge Function via pg_cron + pg_net.
-- Prerequisites:
--   1. Deploy the sync-google-ads-data Edge Function and set its secrets (see below).
--   2. Store project URL and service role key in Vault (run once in SQL Editor or migration):
--        SELECT vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
--        SELECT vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'edge_function_auth_key');
--   3. Replace YOUR_PROJECT_REF and YOUR_SERVICE_ROLE_KEY with your project values.

-- Enable extensions (Supabase hosted usually has these; no-op if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Run sync daily at 02:00 UTC
SELECT cron.schedule(
  'google-ads-sync-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/sync-google-ads-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_auth_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
