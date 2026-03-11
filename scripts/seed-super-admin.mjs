/**
 * Seed default Super Admin via Supabase Admin API (service role).
 * Use when SQL insert into auth.users is blocked on hosted Supabase.
 *
 *   Set in .env (not committed):
 *     SUPABASE_URL=https://xxx.supabase.co
 *     SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *
 *   Run: node scripts/seed-super-admin.mjs
 *
 * Default credentials (change after first login):
 *   Email:    supper@admin.com
 *   Password: Admin!@#$1234
 *   Name:     Super Admin
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const paths = [
    join(process.cwd(), '.env'),
    join(__dirname, '..', '.env'),
  ];
  for (const envPath of paths) {
    try {
      const text = readFileSync(envPath, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (key && val) process.env[key] = val;
      }
      return;
    } catch {
      // try next path
    }
  }
}
loadEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (url && !process.env.SUPABASE_URL) process.env.SUPABASE_URL = url;

const EMAIL = 'supper@admin.com';
const PASSWORD = 'Admin!@#$1234';
const FULL_NAME = 'Super Admin';
const ROLE_ID = '00000000-0000-0000-0000-000000000001'; // super_admin (for role_id schema)
const ROLE_SLUG = 'super_admin'; // for profiles.role (text) schema

if (!url || !serviceKey) {
  console.error('Missing Supabase credentials.');
  console.error('  Set in .env (server-only, never commit):');
  console.error('    SUPABASE_URL or VITE_SUPABASE_URL');
  console.error('    SUPABASE_SERVICE_ROLE_KEY  ← from Supabase Dashboard → Project Settings → API');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

/** Update profile: try role_id (roles table) then role (text) for existing Supabase profiles schema */
async function updateProfileRole(supabase, userId, fullName, email = EMAIL) {
  const updatedAt = new Date().toISOString();
  const base = { id: userId, full_name: fullName, updated_at: updatedAt };
  const withRoleId = { ...base, email, role_id: ROLE_ID };
  const withRoleText = { ...base, email, role: ROLE_SLUG };

  const { error: errId } = await supabase.from('profiles').upsert(withRoleId, { onConflict: 'id' });
  if (!errId) {
    console.log('Updated profiles (role_id) for', EMAIL);
    return;
  }
  const { error: errText } = await supabase.from('profiles').upsert(withRoleText, { onConflict: 'id' });
  if (!errText) {
    console.log('Updated profiles (role = super_admin) for', EMAIL);
    return;
  }
  console.warn('Could not update profile:', errText?.message || errId?.message);
  console.warn('The user exists in Authentication but has no row in profiles. Run the SQL in docs (allow super_admin in profiles_role_check), then run this script again.');
}

const { data, error } = await supabase.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: FULL_NAME },
});

if (error) {
  if (error.message?.includes('already been registered')) {
    console.log('User already exists:', EMAIL);
    const { data: list } = await supabase.auth.admin.listUsers();
    const user = list?.users?.find((u) => u.email === EMAIL);
    if (user) {
      await updateProfileRole(supabase, user.id, FULL_NAME, user.email);
    }
    process.exit(0);
  }
  console.error('createUser failed:', error.message);
  process.exit(1);
}

const userId = data.user.id;
await updateProfileRole(supabase, userId, FULL_NAME, data.user.email ?? EMAIL);

console.log('Super Admin ready:', EMAIL);
