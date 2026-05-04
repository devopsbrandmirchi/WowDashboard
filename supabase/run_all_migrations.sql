-- WowDashboard: run entire migration in Supabase SQL Editor (Dashboard → SQL → New query → Run)
-- Order: extensions → tables → RLS policies → trigger → role seed → super admin seed
-- Safe to re-run where marked idempotent.

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

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL,
  full_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read roles" ON public.roles;
CREATE POLICY "Allow read roles" ON public.roles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow read role_permissions" ON public.role_permissions;
CREATE POLICY "Allow read role_permissions" ON public.role_permissions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "Allow insert profiles" ON public.profiles;
CREATE POLICY "Allow insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Allow update own profile" ON public.profiles;
CREATE POLICY "Allow update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Service role bypasses RLS; anon cannot read profiles by default — add policy if anon needs signup flow.

-- ---------------------------------------------------------------------------
-- 3) New user → profile (idempotent insert)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (new.id, new.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4) Seed roles (matches src/constants/roles.js)
-- ---------------------------------------------------------------------------
INSERT INTO public.roles (id, name, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'super_admin', 'Full access plus role and user management'),
  ('00000000-0000-0000-0000-000000000002', 'admin', 'Full access to all pages and report tabs'),
  ('00000000-0000-0000-0000-000000000003', 'employee', 'Limited access – configurable per permission set')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;

-- ---------------------------------------------------------------------------
-- 5) Role permissions (same as migrations/20250310000000_...)
-- ---------------------------------------------------------------------------
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT r.id, 'sidebar:' || p
FROM public.roles r
CROSS JOIN unnest(ARRAY[
  'dashboard','combined-reporting','google-ads','meta-ads','bing-ads','tiktok-ads',
  'reddit-ads','subscriptions-analytics','subscriptions-subscribers','subscriptions-dating-apps',
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
SELECT id, unnest(ARRAY[
  'sidebar:dashboard','sidebar:google-ads','report:google-ads:campaigntypes'
])
FROM public.roles WHERE name = 'employee'
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6) Optional RPC for frontend
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS text[] AS $$
  SELECT COALESCE(array_agg(rp.permission_key), ARRAY[]::text[])
  FROM public.profiles p
  JOIN public.role_permissions rp ON rp.role_id = p.role_id
  WHERE p.id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- ---------------------------------------------------------------------------
-- 7) Default Super Admin user (may fail on hosted Supabase — then run npm run seed:super-admin)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  super_uid uuid := 'a0000000-0000-0000-0000-000000000001';
  super_email text := 'supper@admin.com';
  super_pass text := 'Admin!@#$1234';
  super_name text := 'Super Admin';
  super_role uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = super_email) THEN
    RAISE NOTICE 'User % already exists; updating profile only.', super_email;
    UPDATE public.profiles SET full_name = super_name, role_id = super_role, updated_at = now()
    WHERE id IN (SELECT id FROM auth.users WHERE email = super_email);
    RETURN;
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at, last_sign_in_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    super_uid, 'authenticated', 'authenticated', super_email,
    crypt(super_pass, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', super_name),
    now(), now(), false, false
  );

  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    super_uid, super_uid,
    jsonb_build_object('sub', super_uid::text, 'email', super_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );

  INSERT INTO public.profiles (id, full_name, role_id, created_at, updated_at)
  VALUES (super_uid, super_name, super_role, now(), now())
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name, role_id = EXCLUDED.role_id, updated_at = now();

  RAISE NOTICE 'Seeded Super Admin: %', super_email;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Auth seed failed (normal on hosted): %. Run: npm run seed:super-admin', SQLERRM;
END $$;

-- Done. Verify:
-- SELECT * FROM public.roles;
-- SELECT * FROM public.profiles LIMIT 5;
