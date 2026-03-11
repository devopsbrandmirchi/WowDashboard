-- Fix 500 on SELECT from profiles (e.g. "column p.role_id does not exist").
-- Run in Supabase SQL Editor if profile fetches return 500.
--
-- Ensures the only SELECT policy on profiles is simple and does not reference
-- role_id or any function that reads profiles.role_id.

DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Optional: ensure insert/update policies exist and are simple
DROP POLICY IF EXISTS "Allow insert profiles" ON public.profiles;
CREATE POLICY "Allow insert profiles"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Allow update own profile" ON public.profiles;
CREATE POLICY "Allow update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);
