-- HubSpot marketing email metrics for the dashboard (live reads from this table only).
-- Default app table name: public.hubspot_marketing_emails
-- Resolves PostgREST schema cache errors when the relation is missing in a fresh project.

CREATE TABLE IF NOT EXISTS public.hubspot_marketing_emails (
  email_id text PRIMARY KEY NOT NULL,
  email_name text,
  delivered bigint,
  open_rate_pct numeric,
  click_rate_pct numeric,
  last_updated_at timestamptz,
  last_updated_by_id text,
  last_updated_by text,
  publish_send_at timestamptz,
  synced_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hubspot_marketing_emails_publish_send_at
  ON public.hubspot_marketing_emails (publish_send_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_hubspot_marketing_emails_synced_at
  ON public.hubspot_marketing_emails (synced_at DESC NULLS LAST);

COMMENT ON TABLE public.hubspot_marketing_emails IS
  'HubSpot email campaign stats; upserted by sync (service role). Dashboard reads via anon/authenticated SELECT.';

ALTER TABLE public.hubspot_marketing_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hubspot_marketing_emails_select_authenticated" ON public.hubspot_marketing_emails;
CREATE POLICY "hubspot_marketing_emails_select_authenticated"
  ON public.hubspot_marketing_emails
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "hubspot_marketing_emails_select_anon" ON public.hubspot_marketing_emails;
CREATE POLICY "hubspot_marketing_emails_select_anon"
  ON public.hubspot_marketing_emails
  FOR SELECT
  TO anon
  USING (true);

NOTIFY pgrst, 'reload schema';
