-- Fix "infinite recursion detected in policy for relation profiles"
-- -----------------------------------------------------------------------------
-- Reason: Any RLS policy on profiles that calls a function which reads profiles
-- can still recurse in some setups. Safer approach: NO extra SELECT policy.
-- Instead, a SECURITY DEFINER RPC reads profiles inside the function only
-- (bypasses RLS as postgres). Only super_admin may call it.
--
-- Run in Supabase SQL Editor.
-- -----------------------------------------------------------------------------

-- Remove the policy that may still cause recursion (calls get_my_profile_role in USING)
DROP POLICY IF EXISTS "Super admin can list all profiles" ON public.profiles;

-- Optional: drop helper if you added it and want a clean slate
-- DROP FUNCTION IF EXISTS public.get_my_profile_role();

-- RPC: return all profiles as JSON array. Runs as definer — does not use RLS on profiles.
CREATE OR REPLACE FUNCTION public.list_profiles_for_admin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  my_role text;
  result jsonb;
BEGIN
  -- Read own role inside definer context (no RLS recursion from a policy)
  SELECT role INTO my_role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
  IF my_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    (SELECT jsonb_agg(to_jsonb(p))
     FROM (
       SELECT id, email, full_name, avatar_url, role, is_active, last_sign_in_at, created_at, updated_at
       FROM public.profiles
       ORDER BY created_at DESC NULLS LAST
     ) p),
    '[]'::jsonb
  ) INTO result;

  RETURN result;
END;
$$;

-- Only authenticated users can invoke; function body still checks super_admin
GRANT EXECUTE ON FUNCTION public.list_profiles_for_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.list_profiles_for_admin() FROM anon;
