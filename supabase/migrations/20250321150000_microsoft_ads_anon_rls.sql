-- Allow anon role to SELECT from Microsoft Ads tables.
-- The frontend (Supabase JS client) may run with the anon key in dev bypass mode
-- (no active Supabase session), so both `anon` and `authenticated` must be granted.

CREATE POLICY "Anon select microsoft_campaigns_ad_group"
  ON public.microsoft_campaigns_ad_group
  FOR SELECT TO anon USING (true);

CREATE POLICY "Anon select microsoft_campaigns_placement"
  ON public.microsoft_campaigns_placement
  FOR SELECT TO anon USING (true);

CREATE POLICY "Anon select microsoft_campaigns_reference_data"
  ON public.microsoft_campaigns_reference_data
  FOR SELECT TO anon USING (true);

CREATE POLICY "Anon select microsoft_ads_sync_by_date"
  ON public.microsoft_ads_sync_by_date
  FOR SELECT TO anon USING (true);
