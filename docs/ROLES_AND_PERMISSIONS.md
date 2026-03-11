# Roles & Permissions Implementation Guide

This document describes how to implement role-based access control (RBAC) for WowDashboard: sidebar visibility and internal report tabs (e.g., Google Ads Campaign Types only).

---

## Roles model

| # | Display name   | DB `roles.name` | Description |
|---|----------------|-----------------|-------------|
| 1 | Super Admin    | `super_admin`   | Full access + `admin:manage_roles` / `admin:manage_users` |
| 2 | Admin          | `admin`         | Full access to all sidebar pages and report tabs |
| 3 | Employee       | `employee`      | Limited; assign only the permission keys they need |

Frontend: `src/constants/roles.js` — use `ROLES`, `ROLE_IDS`, `getRoleBySlug()`, `isRoleAtLeast()`.

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
- `sidebar:roles-permissions` (Roles & Permissions under System)

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

### 0. One-shot run (recommended)

Open **Supabase Dashboard → SQL Editor → New query**, paste the contents of:

**`supabase/run_all_migrations.sql`**

Click **Run**. That creates `roles`, `role_permissions`, `profiles`, RLS, trigger, seeds roles/permissions, and attempts the Super Admin user. If step 7 errors on hosted projects, run `npm run seed:super-admin` after adding `SUPABASE_SERVICE_ROLE_KEY` to `.env`.

---

### 1. Run this SQL in Supabase SQL Editor (same schema, manual blocks)

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

-- Seed default roles (Super Admin, Admin, Employee)
-- Must match src/constants/roles.js ROLE_IDS
INSERT INTO public.roles (id, name, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'super_admin', 'Full access plus role and user management'),
  ('00000000-0000-0000-0000-000000000002', 'admin', 'Full access to all pages and report tabs'),
  ('00000000-0000-0000-0000-000000000003', 'employee', 'Limited access – configurable per permission set')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;

-- Or run: supabase/migrations/20250310000000_roles_super_admin_admin_employee.sql

-- Grant Super Admin + Admin all sidebar permissions
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT r.id, 'sidebar:' || p
FROM public.roles r, unnest(ARRAY['dashboard','combined-reporting','google-ads','meta-ads','bing-ads','tiktok-ads','reddit-ads','amazon-ads','dsp','dating-apps','ctv','ga4','email','ghl','ott','seo','geo','creatives','events','settings']) AS p
WHERE r.name IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- Grant Super Admin + Admin all Google Ads report tabs
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT r.id, 'report:google-ads:' || t
FROM public.roles r, unnest(ARRAY['campaigntypes','campaigns','adgroups','keywords','searchterms','geo','country','product','shows','conversions']) AS t
WHERE r.name IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- Super Admin only: manage roles/users (optional permission keys)
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT id, k FROM public.roles, unnest(ARRAY['admin:manage_roles','admin:manage_users']) AS k
WHERE name = 'super_admin'
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- Employee: example limited set (customize as needed)
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT id, unnest(ARRAY['sidebar:dashboard','sidebar:google-ads','report:google-ads:campaigntypes'])
FROM public.roles WHERE name = 'employee'
ON CONFLICT (role_id, permission_key) DO NOTHING;
```

### 2. Default Super Admin user (seed)

App user data lives in **`public.profiles`** (linked to `auth.users` by `profiles.id`). There is no separate custom user table required; `profiles` + `roles` is the user model.

Default seed (run after `roles` + `profiles` exist):

| Field    | Value              |
|----------|--------------------|
| Name     | Super Admin        |
| Email    | `supper@admin.com` |
| Password | `Admin!@#$1234`    |
| Role     | `super_admin`      |

**Option A – SQL migration** (local/self-hosted; may fail on hosted Supabase if `auth` writes are restricted):

- Run `supabase/migrations/20250310000001_seed_super_admin_user.sql` in SQL Editor.

**Option B – Admin API script** (recommended for hosted):

```bash
# .env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (never commit service key)
npm run seed:super-admin
```

Script: `scripts/seed-super-admin.mjs` — creates the user and upserts profile (role_id or text `role`) to Super Admin.

**"User already exists" but no row in `profiles`?**

The user is stored in **Authentication** (`auth.users`), not in the `profiles` table. The script creates the profile row when it runs; if that step fails (e.g. `profiles_role_check`), the user can sign in but won’t appear in the Data Editor → `profiles` until the profile is created. Fix the constraint (below), then run the seed again to create the profile row.

**If you see this when running the seed:**

```
User already exists: supper@admin.com
Could not update profile: new row for relation "profiles" violates check constraint "profiles_role_check"
```

Your `profiles.role` column only allows certain values (e.g. `viewer`). Do one of the following:

1. **Allow `super_admin` in the DB** — In Supabase **SQL Editor**, run:

```sql
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IS NULL OR role IN (
    'viewer', 'editor', 'admin', 'super_admin', 'employee'
  ));
```

Then run `npm run seed:super-admin` again.
2. **Or set role manually** — In **Table Editor → profiles**, find the row for `supper@admin.com`, edit the `role` cell to `super_admin` (if your constraint already allows it) or to an allowed value like `admin` until you run the SQL in step 1.

**Option C – Dashboard**

Authentication → Users → Add user → same email/password → then:

```sql
UPDATE public.profiles SET role_id = '00000000-0000-0000-0000-000000000001', full_name = 'Super Admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'supper@admin.com');
```

**Production:** change the password after first login; do not rely on the default password.

---

### 3. Assign role to a user

```sql
-- After user signs up, assign role (e.g. via Supabase Dashboard or admin UI)
-- Employee example
UPDATE public.profiles SET role_id = '00000000-0000-0000-0000-000000000003' WHERE id = 'user-uuid-here';
-- Admin: ...000002 | Super Admin: ...000001
```

### 4. Users page: let super_admin list all profiles (fix RLS recursion)

If the **Users** page shows *"infinite recursion detected in policy for relation profiles"*, a policy is reading from `profiles` to decide who can read `profiles`. Fix it by using a **SECURITY DEFINER** function so the role check does not go through RLS.

Run in **Supabase → SQL Editor** the contents of:

**`supabase/rls_super_admin_list_profiles.sql`**

That **drops** the recursive-style policy and adds **`list_profiles_for_admin()`** — a `SECURITY DEFINER` RPC that reads `profiles` inside the function only (no RLS recursion). The Users page calls this RPC first; only callers whose `profiles.role` is `super_admin` get data (others get “not allowed”).

---

### 5. API to fetch user permissions

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

### 6. GoogleAdsPage.jsx

- Filter `TABS` by `hasPermission('report:google-ads:' + tab.id)`
- If `activeTab` is not allowed, switch to first allowed tab
- If no tabs allowed, hide the report or show a message

### 7. Super Admin: assign which role accesses which model

On **Roles & Permissions** (System), Super Admin can assign permissions per role: select role, tick sidebar pages / report tabs / admin keys, then **Save**. Run in SQL Editor: (1) **`supabase/create_roles_and_role_permissions.sql`** to create `roles` and `role_permissions` and seed them; (2) **`supabase/rpc_role_permissions.sql`** to add `get_role_permissions(role_id)` and `set_role_permissions(role_id, permission_keys)` (only Super Admin can set).

### 8. Admin UI (optional, later)

- Assign roles to users (e.g. on Users page)

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
