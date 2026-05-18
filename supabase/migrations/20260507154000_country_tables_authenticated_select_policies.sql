-- Ensure authenticated users can read country sync tables in the app.
-- SQL editor/service role can see rows even when app users cannot (RLS).

-- Google country tables
ALTER TABLE IF EXISTS public.google_campaigns_data_country ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated select google_campaigns_data_country" ON public.google_campaigns_data_country;
CREATE POLICY "Authenticated select google_campaigns_data_country"
  ON public.google_campaigns_data_country
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE IF EXISTS public.google_ad_groups_data_country ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated select google_ad_groups_data_country" ON public.google_ad_groups_data_country;
CREATE POLICY "Authenticated select google_ad_groups_data_country"
  ON public.google_ad_groups_data_country
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE IF EXISTS public.google_keywords_data_country ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated select google_keywords_data_country" ON public.google_keywords_data_country;
CREATE POLICY "Authenticated select google_keywords_data_country"
  ON public.google_keywords_data_country
  FOR SELECT
  TO authenticated
  USING (true);

-- Facebook country table
ALTER TABLE IF EXISTS public.facebook_campaigns_data_country ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated select facebook_campaigns_data_country" ON public.facebook_campaigns_data_country;
CREATE POLICY "Authenticated select facebook_campaigns_data_country"
  ON public.facebook_campaigns_data_country
  FOR SELECT
  TO authenticated
  USING (true);
