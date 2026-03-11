-- Create roles and role_permissions tables (required before rpc_role_permissions.sql).
-- Run this in Supabase SQL Editor first if you get "relation public.role_permissions does not exist".
-- Does NOT touch profiles; your existing profiles.role (text) stays as is.

-- ---------------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  UNIQUE(role_id, permission_key)
);

-- ---------------------------------------------------------------------------
-- 2) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read roles" ON public.roles;
CREATE POLICY "Allow read roles" ON public.roles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow read role_permissions" ON public.role_permissions;
CREATE POLICY "Allow read role_permissions" ON public.role_permissions FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 3) Seed roles (IDs match src/constants/roles.js ROLE_IDS)
-- ---------------------------------------------------------------------------
INSERT INTO public.roles (id, name, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'super_admin', 'Full access plus role and user management'),
  ('00000000-0000-0000-0000-000000000002', 'admin', 'Full access to all pages and report tabs'),
  ('00000000-0000-0000-0000-000000000003', 'employee', 'Limited access – configurable per permission set'),
  ('00000000-0000-0000-0000-000000000004', 'viewer', 'View-only access – configurable per permission set'),
  ('00000000-0000-0000-0000-000000000005', 'editor', 'Edit access – configurable per permission set')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;

-- Optional: seed default permissions (Super Admin + Admin get all sidebar; Employee gets a few)
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT r.id, 'sidebar:' || p
FROM public.roles r
CROSS JOIN unnest(ARRAY[
  'dashboard','combined-reporting','google-ads','meta-ads','bing-ads','tiktok-ads',
  'reddit-ads','subscriptions-analytics','subscriptions-subscribers',
  'settings','roles-permissions','users'
]) AS p
WHERE r.name IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission_key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT r.id, 'report:google-ads:' || t
FROM public.roles r
CROSS JOIN unnest(ARRAY[
  'campaigntypes','campaigns','adgroups','keywords','searchterms','geo','country','product','shows','conversions'
]) AS t
WHERE r.name IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission_key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT id, unnest(ARRAY['admin:manage_roles','admin:manage_users'])
FROM public.roles WHERE name = 'super_admin'
ON CONFLICT (role_id, permission_key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT id, unnest(ARRAY['sidebar:dashboard','sidebar:google-ads','report:google-ads:campaigntypes'])
FROM public.roles WHERE name = 'employee'
ON CONFLICT (role_id, permission_key) DO NOTHING;
