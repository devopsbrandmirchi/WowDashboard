-- Allow authenticated users to read and update google_campaigns_reference_data
-- (used by Settings > Google Campaigns Reference page to fill country, product_type, showname).
ALTER TABLE public.google_campaigns_reference_data ENABLE ROW LEVEL SECURITY;

-- Allow read for authenticated users
CREATE POLICY "Authenticated users can select google_campaigns_reference_data"
  ON public.google_campaigns_reference_data
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow update of country, product_type, showname for authenticated users
CREATE POLICY "Authenticated users can update google_campaigns_reference_data"
  ON public.google_campaigns_reference_data
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
