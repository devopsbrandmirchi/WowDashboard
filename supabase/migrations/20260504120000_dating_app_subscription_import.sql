-- Dating app subscription campaign Excel imports (WOW-style sheets: by app + by country).

CREATE TABLE IF NOT EXISTS public.dating_app_subscription_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_title text,
  source_filename text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dating_app_subscription_uploads_uploaded_at
  ON public.dating_app_subscription_uploads (uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_dating_app_subscription_uploads_uploaded_by
  ON public.dating_app_subscription_uploads (uploaded_by);

CREATE TABLE IF NOT EXISTS public.dating_app_subscription_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.dating_app_subscription_uploads (id) ON DELETE CASCADE,
  breakdown text NOT NULL CHECK (breakdown IN ('by_app', 'by_country')),
  row_label text NOT NULL,
  is_total boolean NOT NULL DEFAULT false,
  spend numeric(14,4),
  impressions bigint,
  clicks bigint,
  cpm numeric(14,4),
  cpc numeric(14,4)
);

CREATE INDEX IF NOT EXISTS idx_dating_app_subscription_metrics_upload_id
  ON public.dating_app_subscription_metrics (upload_id);

ALTER TABLE public.dating_app_subscription_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dating_app_subscription_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dating_app_subscription_uploads_select" ON public.dating_app_subscription_uploads;
CREATE POLICY "dating_app_subscription_uploads_select"
  ON public.dating_app_subscription_uploads FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "dating_app_subscription_uploads_insert" ON public.dating_app_subscription_uploads;
CREATE POLICY "dating_app_subscription_uploads_insert"
  ON public.dating_app_subscription_uploads FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

DROP POLICY IF EXISTS "dating_app_subscription_uploads_delete_own" ON public.dating_app_subscription_uploads;
CREATE POLICY "dating_app_subscription_uploads_delete_own"
  ON public.dating_app_subscription_uploads FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid());

DROP POLICY IF EXISTS "dating_app_subscription_metrics_select" ON public.dating_app_subscription_metrics;
CREATE POLICY "dating_app_subscription_metrics_select"
  ON public.dating_app_subscription_metrics FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "dating_app_subscription_metrics_insert_own_upload" ON public.dating_app_subscription_metrics;
CREATE POLICY "dating_app_subscription_metrics_insert_own_upload"
  ON public.dating_app_subscription_metrics FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.dating_app_subscription_uploads u
      WHERE u.id = upload_id AND u.uploaded_by = auth.uid()
    )
  );

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT r.id, 'sidebar:subscriptions-dating-apps'
FROM public.roles r
WHERE r.name IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission_key) DO NOTHING;
