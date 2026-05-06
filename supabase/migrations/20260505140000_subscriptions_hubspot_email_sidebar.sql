-- Sidebar permission for HubSpot email marketing report (Subscriptions).
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT r.id, 'sidebar:subscriptions-hubspot-email'
FROM public.roles r
WHERE r.name IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission_key) DO NOTHING;
