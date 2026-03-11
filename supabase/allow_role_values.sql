-- Allow super_admin, admin, employee in profiles.role
-- Run in Supabase SQL Editor if seed fails with: profiles_role_check
-- (Your table may only allow 'viewer', 'editor', etc.)

DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IS NULL OR role IN (
    'super_admin', 'admin', 'employee',
    'viewer', 'editor'
  ));
