-- If your profiles table uses role (text) instead of role_id (uuid), use this version of get_my_permissions.
-- Run in Supabase SQL Editor so the frontend permission checks match the role_permissions table.
-- Then Viewer (and other roles) will see only the sidebar items they have permissions for.

CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS text[] AS $$
  SELECT COALESCE(array_agg(rp.permission_key), ARRAY[]::text[])
  FROM public.profiles p
  JOIN public.roles r ON r.name = p.role
  JOIN public.role_permissions rp ON rp.role_id = r.id
  WHERE p.id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
