-- Dashboard shows 0 rows when RLS is enabled on hubspot_marketing_emails but no SELECT policy exists
-- (PostgREST returns 200 + [] with no error). This adds read access for logged-in and anon clients.

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
