-- Add campaigns reference sidebar permissions for Super Admin and Admin roles.
-- This enables access to all campaigns reference pages in the sidebar.

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT r.id, 'sidebar:' || p
FROM public.roles r
CROSS JOIN unnest(ARRAY[
  'google-campaigns-reference',
  'reddit-campaigns-reference',
  'tiktok-campaigns-reference',
  'facebook-campaigns-reference',
  'facebook-adset-reference',
  'microsoft-campaigns-reference'
]) AS p
WHERE r.name IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission_key) DO NOTHING;
