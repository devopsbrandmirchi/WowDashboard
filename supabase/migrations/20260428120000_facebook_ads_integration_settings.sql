-- Store Meta/Facebook user access token set from Settings (Edge Function with service role).
-- Sync functions read this row first; if empty, they use FB_ACCESS_TOKEN secret, then app token.

CREATE TABLE IF NOT EXISTS public.facebook_ads_integration_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  access_token text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.facebook_ads_integration_settings (id, access_token)
VALUES (1, '')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.facebook_ads_integration_settings ENABLE ROW LEVEL SECURITY;

-- No policies: authenticated users cannot read/write tokens directly (only service role / Edge Functions).

COMMENT ON TABLE public.facebook_ads_integration_settings IS 'Singleton (id=1). Meta Graph user token; managed via save-facebook-meta-token Edge Function.';
