import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase.js';
import { ROLE_IDS, getRoleBySlug } from '../constants/roles.js';

/** Role slugs that can access Users and Roles & Permissions (admin pages) */
const ADMIN_ROLE_SLUGS = ['super_admin', 'admin'];

/** Role UUIDs that have full access (when DB uses role_id not role text) */
const ADMIN_ROLE_IDS = [ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN];

/** Role UUIDs that can open Roles & Permissions (read-only) but not Users or Settings */
const LIMITED_ROLE_IDS = [ROLE_IDS.VIEWER, ROLE_IDS.EMPLOYEE, ROLE_IDS.EDITOR];

export function useUserPermissions() {
  const { user } = useAuth();
  const [role, setRole] = useState(null);
  const [roleId, setRoleId] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setRole(null);
      setRoleId(null);
      setPermissions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();

        if (!cancelled && !profileError && profile) {
          setRole(profile.role ?? null);
          setRoleId(profile.role_id ?? (profile.role ? getRoleBySlug(profile.role)?.id ?? null : null));
        }
        if (!cancelled && profileError) {
          setRoleId(null);
          setRole(null);
        }

        const { data: permData, error: permError } = await supabase.rpc('get_my_permissions');
        if (!cancelled) {
          if (!permError && Array.isArray(permData) && permData.length > 0) {
            setPermissions(permData);
          } else {
            setPermissions([]);
          }
        }
      } catch {
        if (!cancelled) {
          setRole(null);
          setRoleId(null);
          setPermissions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  const canAccessSidebar = useCallback((navId) => {
    const key = `sidebar:${navId}`;
    const limitedRoleSlugs = ['viewer', 'employee', 'editor'];
    const isLimitedRole = (role && limitedRoleSlugs.includes(role)) || (roleId && LIMITED_ROLE_IDS.includes(roleId));

    if (ADMIN_ROLE_SLUGS.includes(role) || (roleId && ADMIN_ROLE_IDS.includes(roleId))) {
      return true;
    }
    if (isLimitedRole) {
      return !['users', 'settings', 'google-campaigns-reference', 'reddit-campaigns-reference', 'tiktok-campaigns-reference', 'facebook-campaigns-reference', 'facebook-adset-reference'].includes(navId);
    }
    if (permissions.length > 0) {
      return permissions.includes(key);
    }
    return true;
  }, [role, roleId, permissions]);

  const canAccessUsers = useCallback(() => canAccessSidebar('users'), [canAccessSidebar]);
  const canAccessRolesPermissions = useCallback(() => canAccessSidebar('roles-permissions'), [canAccessSidebar]);

  /** Only Super Admin can edit roles/permissions; others see read-only. */
  const canEditRolesPermissions = useCallback(
    () => role === 'super_admin' || roleId === ROLE_IDS.SUPER_ADMIN,
    [role, roleId]
  );

  return {
    role,
    roleId,
    permissions,
    loading,
    canAccessSidebar,
    canAccessUsers,
    canAccessRolesPermissions,
    canEditRolesPermissions,
  };
}
