-- RPCs for Super Admin to get/set which role has which permissions (role_permissions table).
-- Supported roles: super_admin, admin, employee, viewer, editor (seed in create_roles_and_role_permissions.sql).
-- Run in Supabase SQL Editor AFTER creating the tables:
--   If you get "relation public.role_permissions does not exist", run
--   supabase/create_roles_and_role_permissions.sql first, then run this file.

-- Get permission keys for a role (any authenticated user can read for the UI)
CREATE OR REPLACE FUNCTION public.get_role_permissions(p_role_id uuid)
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(permission_key ORDER BY permission_key), ARRAY[]::text[])
  FROM public.role_permissions
  WHERE role_id = p_role_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_role_permissions(uuid) TO authenticated;

-- Set permission keys for a role (only super_admin can call)
-- Uses profiles.role (text). If your table has role_id instead, use role_id = '00000000-0000-0000-0000-000000000001'.
CREATE OR REPLACE FUNCTION public.set_role_permissions(p_role_id uuid, p_permission_keys text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  my_role text;
  k text;
BEGIN
  SELECT role INTO my_role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
  IF my_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only Super Admin can assign role permissions' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.role_permissions WHERE role_id = p_role_id;

  IF p_permission_keys IS NOT NULL AND array_length(p_permission_keys, 1) > 0 THEN
    FOREACH k IN ARRAY p_permission_keys
    LOOP
      INSERT INTO public.role_permissions (role_id, permission_key)
      VALUES (p_role_id, k)
      ON CONFLICT (role_id, permission_key) DO NOTHING;
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_role_permissions(uuid, text[]) TO authenticated;
