-- App ID / secret for Graph client_credentials (same row as access_token; Edge Functions read DB first, then env).

ALTER TABLE public.facebook_ads_integration_settings
  ADD COLUMN IF NOT EXISTS fb_app_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS fb_app_secret text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.facebook_ads_integration_settings.fb_app_id IS 'Meta App ID; used with fb_app_secret for app access token when no user token.';
COMMENT ON COLUMN public.facebook_ads_integration_settings.fb_app_secret IS 'Meta App Secret; service role / Edge Functions only.';
COMMENT ON TABLE public.facebook_ads_integration_settings IS 'Singleton (id=1). Meta app credentials + user access_token; managed via save-facebook-meta-token Edge Function.';
