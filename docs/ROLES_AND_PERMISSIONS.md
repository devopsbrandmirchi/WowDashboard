# Roles & Permissions Implementation Guide

This document describes how to implement role-based access control (RBAC) for WowDashboard: sidebar visibility and internal report tabs (e.g., Google Ads Campaign Types only).

---

## Permission Keys

| Type | Format | Example |
|------|--------|---------|
| Sidebar page | `sidebar:{pageId}` | `sidebar:google-ads`, `sidebar:meta-ads`, `sidebar:settings` |
| Report tab | `report:{reportId}:{tabId}` | `report:google-ads:campaigntypes`, `report:google-ads:campaigns` |

### Sidebar Pages (from `NAV_ITEMS` in Sidebar.jsx)
- `sidebar:dashboard`
- `sidebar:combined-reporting`
- `sidebar:google-ads`, `sidebar:meta-ads`, `sidebar:bing-ads`, `sidebar:tiktok-ads`, `sidebar:reddit-ads`, `sidebar:amazon-ads`
- `sidebar:dsp`, `sidebar:dating-apps`, `sidebar:ctv`
- `sidebar:ga4`, `sidebar:email`, `sidebar:ghl`, `sidebar:ott`
- `sidebar:seo`, `sidebar:geo`, `sidebar:creatives`, `sidebar:events`
- `sidebar:settings`

### Google Ads Report Tabs
- `report:google-ads:campaigntypes`
- `report:google-ads:campaigns`
- `report:google-ads:adgroups`
- `report:google-ads:keywords`
- `report:google-ads:searchterms`
- `report:google-ads:geo`
- `report:google-ads:country`
- `report:google-ads:product`
- `report:google-ads:shows`
- `report:google-ads:conversions`

---

## Supabase Changes

### 1. Run this SQL in Supabase SQL Editor

```sql
-- Roles table
CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Role permissions: which permission keys each role has
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  UNIQUE(role_id, permission_key)
);

-- Profiles: extends auth.users with role
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL,
  full_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS: Anyone authenticated can read roles and role_permissions (for permission checks)
CREATE POLICY "Allow read roles" ON public.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read role_permissions" ON public.role_permissions FOR SELECT TO authenticated USING (true);

-- RLS: Users can read their own profile
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);

-- RLS: Only admins can manage roles/permissions (optional - add role check later)
-- For now, allow service role or add an 'admin' role check
CREATE POLICY "Allow insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Allow update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Function to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (new.id, new.raw_user_meta_data->>'full_name'::text);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed default roles
INSERT INTO public.roles (id, name, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin', 'Full access to all pages and features'),
  ('00000000-0000-0000-0000-000000000002', 'analyst', 'Access to reports and dashboards'),
  ('00000000-0000-0000-0000-000000000003', 'client', 'Limited access - configurable per client')
ON CONFLICT DO NOTHING;

-- Grant admin all sidebar permissions (example - add more as needed)
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT id, 'sidebar:' || unnest(ARRAY['dashboard','combined-reporting','google-ads','meta-ads','bing-ads','tiktok-ads','reddit-ads','amazon-ads','dsp','dating-apps','ctv','ga4','email','ghl','ott','seo','geo','creatives','events','settings'])
FROM public.roles WHERE name = 'admin'
ON CONFLICT DO NOTHING;

-- Grant admin all Google Ads report tabs
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT id, 'report:google-ads:' || unnest(ARRAY['campaigntypes','campaigns','adgroups','keywords','searchterms','geo','country','product','shows','conversions'])
FROM public.roles WHERE name = 'admin'
ON CONFLICT DO NOTHING;

-- Example: client role sees only Campaign Types in Google Ads
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT id, unnest(ARRAY['sidebar:dashboard','sidebar:google-ads','report:google-ads:campaigntypes'])
FROM public.roles WHERE name = 'client'
ON CONFLICT DO NOTHING;
```

### 2. Assign role to a user

```sql
-- After user signs up, assign role (e.g. via Supabase Dashboard or admin UI)
UPDATE public.profiles SET role_id = '00000000-0000-0000-0000-000000000003' WHERE id = 'user-uuid-here';
```

### 3. API to fetch user permissions

Create a Supabase function or use a view. For simplicity, the frontend will fetch:

1. `profiles` (joined with `roles`) for the current user
2. `role_permissions` for that role

Or a single RPC:

```sql
CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS text[] AS $$
  SELECT COALESCE(array_agg(rp.permission_key), '{}')::text[]
  FROM public.profiles p
  JOIN public.role_permissions rp ON rp.role_id = p.role_id
  WHERE p.id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

---

## Frontend Changes

### 1. New: `src/context/PermissionsContext.jsx`

- Fetch permissions on login (from `get_my_permissions` or profiles + role_permissions)
- Expose `hasPermission(key)` and `permissions` array
- Cache in state; refetch when user changes

### 2. AuthContext

- When `AUTH_BYPASS` is true, grant all permissions (or a default set for dev)
- When real auth, permissions come from PermissionsContext

### 3. Sidebar.jsx

- Filter `NAV_ITEMS` by `hasPermission('sidebar:' + item.id)`
- Hide items the user cannot access

### 4. App.jsx

- Before rendering `CurrentPage`, check `hasPermission('sidebar:' + currentPage)`
- If no permission, redirect to first allowed page or show "Access denied"

### 5. GoogleAdsPage.jsx

- Filter `TABS` by `hasPermission('report:google-ads:' + tab.id)`
- If `activeTab` is not allowed, switch to first allowed tab
- If no tabs allowed, hide the report or show a message

### 6. Admin UI (optional, later)

- Page to manage roles and permissions
- Assign roles to users

---

## Summary of Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/xxx_roles_permissions.sql` | Create (or run SQL manually in Supabase) |
| `src/context/PermissionsContext.jsx` | Create |
| `src/context/AuthContext.jsx` | Modify (integrate bypass + permissions) |
| `src/components/Sidebar.jsx` | Modify (filter by permissions) |
| `src/App.jsx` | Modify (route guard, redirect) |
| `src/pages/GoogleAdsPage.jsx` | Modify (filter tabs by permissions) |
| `src/main.jsx` | Modify (wrap with PermissionsProvider) |

---

## Bypass Mode

When `VITE_AUTH_BYPASS=true`, the app can either:
- Grant all permissions (simplest for dev)
- Or use a default permission set from env (e.g. `VITE_DEFAULT_PERMISSIONS=sidebar:dashboard,sidebar:google-ads,report:google-ads:campaigntypes`)
