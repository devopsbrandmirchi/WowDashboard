-- WowDashboard roles: Super Admin, Admin, Employee
-- Run after base roles/profiles tables exist (see docs/ROLES_AND_PERMISSIONS.md).

-- Seed three roles (fixed IDs for stable references in code: src/constants/roles.js)
INSERT INTO public.roles (id, name, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'super_admin', 'Full access plus role and user management'),
  ('00000000-0000-0000-0000-000000000002', 'admin', 'Full access to all pages and report tabs'),
  ('00000000-0000-0000-0000-000000000003', 'employee', 'Limited access – configurable per permission set')
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description;

-- Optional: remove legacy roles if you no longer use them (uncomment if needed)
-- DELETE FROM public.role_permissions WHERE role_id IN (SELECT id FROM public.roles WHERE name IN ('analyst','client'));
-- DELETE FROM public.roles WHERE name IN ('analyst','client');

-- Super Admin & Admin: all sidebar pages
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT r.id, 'sidebar:' || p
FROM public.roles r
CROSS JOIN unnest(ARRAY[
  'dashboard','combined-reporting','google-ads','meta-ads','bing-ads','tiktok-ads',
  'reddit-ads','amazon-ads','dsp','dating-apps','ctv','ga4','email','ghl','ott',
  'seo','geo','creatives','events','settings'
]) AS p
WHERE r.name IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- Super Admin & Admin: all Google Ads report tabs
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT r.id, 'report:google-ads:' || t
FROM public.roles r
CROSS JOIN unnest(ARRAY[
  'campaigntypes','campaigns','adgroups','keywords','searchterms','geo','country','product','shows','conversions'
]) AS t
WHERE r.name IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- Super Admin only: manage roles/users
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT id, unnest(ARRAY['admin:manage_roles','admin:manage_users'])
FROM public.roles WHERE name = 'super_admin'
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- Employee: example limited set (adjust as needed)
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT id, unnest(ARRAY[
  'sidebar:dashboard',
  'sidebar:google-ads',
  'report:google-ads:campaigntypes'
])
FROM public.roles WHERE name = 'employee'
ON CONFLICT (role_id, permission_key) DO NOTHING;
