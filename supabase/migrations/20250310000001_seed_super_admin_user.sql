-- Default Super Admin user (profiles = app user table; auth.users = login)
-- ---------------------------------------------------------------------------
-- Email:    supper@admin.com
-- Password: Admin!@#$1234
-- Name:     Super Admin
-- Role:     super_admin (ROLE_IDS.SUPER_ADMIN)
--
-- SECURITY: Change password after first login in production. Do not commit
-- real passwords in production DBs; rotate via Dashboard or admin API.
--
-- Hosted Supabase may block direct auth inserts. If this fails, use either:
--   1) Dashboard → Authentication → Users → Add user (same email/password)
--   2) scripts/seed-super-admin.mjs with SUPABASE_SERVICE_ROLE_KEY
-- ---------------------------------------------------------------------------

-- Fixed UUID so profiles/roles stay predictable (optional; change if conflict)
-- \set super_admin_user_id 'a0000000-0000-0000-0000-000000000001'

-- Requires extension for crypt()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  super_uid uuid := 'a0000000-0000-0000-0000-000000000001';
  super_email text := 'supper@admin.com';
  super_pass text := 'Admin!@#$1234';
  super_name text := 'Super Admin';
  super_role uuid := '00000000-0000-0000-0000-000000000001'; -- ROLE_IDS.SUPER_ADMIN
BEGIN
  -- Skip if user already exists
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = super_email) THEN
    RAISE NOTICE 'User % already exists; skipping auth insert.', super_email;
    RETURN;
  END IF;

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    is_sso_user,
    is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    super_uid,
    'authenticated',
    'authenticated',
    super_email,
    crypt(super_pass, gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    json_build_object('full_name', super_name)::jsonb,
    now(),
    now(),
    false,
    false
  );

  INSERT INTO auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    super_uid,
    super_uid,
    json_build_object(
      'sub', super_uid::text,
      'email', super_email,
      'email_verified', true,
      'phone_verified', false
    )::jsonb,
    'email',
    now(),
    now(),
    now()
  );

  -- Profile: trigger may have inserted row without role; upsert
  INSERT INTO public.profiles (id, full_name, role_id, created_at, updated_at)
  VALUES (super_uid, super_name, super_role, now(), now())
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role_id = EXCLUDED.role_id,
    updated_at = now();

  RAISE NOTICE 'Seeded Super Admin: %', super_email;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Seed failed (use Dashboard or scripts/seed-super-admin.mjs): %', SQLERRM;
END $$;
