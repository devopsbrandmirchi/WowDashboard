-- Fix get_my_permissions when profiles has role (text), not role_id.
-- Run in Supabase Dashboard → SQL Editor.
-- Joins: profiles.role → roles.name → role_permissions.role_id

CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS text[] AS $$
  SELECT COALESCE(array_agg(rp.permission_key), ARRAY[]::text[])
  FROM public.profiles p
  JOIN public.roles r ON r.name = p.role
  JOIN public.role_permissions rp ON rp.role_id = r.id
  WHERE p.id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO service_role;
