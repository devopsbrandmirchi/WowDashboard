-- Add RPCs for Super Admin to update and soft-deactivate users (Users page).
-- Ensures profiles has role (text) and is_active if missing, then creates the functions.

-- Ensure profiles has columns expected by list_profiles_for_admin and update_profile_for_admin
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;

-- Update a user's full_name and role (Super Admin only). profiles has role text, no role_id.
CREATE OR REPLACE FUNCTION public.update_profile_for_admin(
  p_id uuid,
  p_full_name text DEFAULT NULL,
  p_role text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  my_role text;
BEGIN
  SELECT role INTO my_role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
  IF my_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only Super Admin can update users' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET
    full_name = COALESCE(p_full_name, full_name),
    role = COALESCE(p_role, role),
    updated_at = now()
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_profile_for_admin(uuid, text, text) TO authenticated;

-- Set user active/inactive (soft delete; Super Admin only). profiles has role text, is_active.
CREATE OR REPLACE FUNCTION public.set_profile_active_for_admin(p_id uuid, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  my_role text;
BEGIN
  SELECT role INTO my_role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
  IF my_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only Super Admin can deactivate users' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles SET is_active = p_is_active, updated_at = now() WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_profile_active_for_admin(uuid, boolean) TO authenticated;
