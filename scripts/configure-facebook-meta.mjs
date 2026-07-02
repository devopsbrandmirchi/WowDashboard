/**
 * Save Meta app credentials + user token to facebook_ads_integration_settings.
 * Exchanges short-lived tokens for long-lived when app id/secret are provided.
 *
 * Set in .env (not committed):
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Pass secrets via env (do not commit):
 *   FB_APP_ID, FB_APP_SECRET, FB_USER_TOKEN
 *
 * Run: node scripts/configure-facebook-meta.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_VERSION = 'v21.0';

function loadEnv() {
  const paths = [join(process.cwd(), '.env'), join(__dirname, '..', '.env')];
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
        if (key && val && process.env[key] == null) process.env[key] = val;
      }
      return;
    } catch {
      /* try next */
    }
  }
}

async function exchangeForLongLived(appId, appSecret, userToken) {
  const u = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  u.searchParams.set('grant_type', 'fb_exchange_token');
  u.searchParams.set('client_id', appId);
  u.searchParams.set('client_secret', appSecret);
  u.searchParams.set('fb_exchange_token', userToken);
  const res = await fetch(u.toString());
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Token exchange failed (${res.status})`);
  }
  if (!json.access_token || json.access_token.length < 20) {
    throw new Error('Facebook did not return a usable access token.');
  }
  return { token: json.access_token, expiresIn: json.expires_in ?? null };
}

async function verifyInsightsToken(token, adAccountId) {
  const account = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const u = new URL(`https://graph.facebook.com/v19.0/${account}/insights`);
  u.searchParams.set('level', 'ad');
  u.searchParams.set('time_increment', '1');
  u.searchParams.set('time_range', JSON.stringify({ since: '2026-06-25', until: '2026-06-25' }));
  u.searchParams.set('fields', 'impressions');
  u.searchParams.set('limit', '1');
  u.searchParams.set('access_token', token);
  const res = await fetch(u.toString());
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Insights probe failed (${res.status})`);
  }
}

loadEnv();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appId = process.env.FB_APP_ID?.trim();
const appSecret = process.env.FB_APP_SECRET?.trim();
const userToken = process.env.FB_USER_TOKEN?.trim();
const adAccountId = process.env.FB_AD_ACCOUNT_ID?.trim() || '114810198697538';

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
if (!appId || !appSecret || !userToken) {
  console.error('Set FB_APP_ID, FB_APP_SECRET, and FB_USER_TOKEN in the environment for this run.');
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceKey);

const { token: longToken, expiresIn } = await exchangeForLongLived(appId, appSecret, userToken);
console.log('Exchanged for long-lived token.', expiresIn ? `expires_in=${expiresIn}s` : '');

await verifyInsightsToken(longToken, adAccountId);
console.log(`Token verified against ${adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`}.`);

const { error } = await admin.from('facebook_ads_integration_settings').upsert(
  {
    id: 1,
    fb_app_id: appId,
    fb_app_secret: appSecret,
    access_token: longToken,
    updated_at: new Date().toISOString(),
  },
  { onConflict: 'id' }
);

if (error) {
  console.error('Upsert failed:', error.message);
  process.exit(1);
}

console.log('Saved Meta app credentials and long-lived token to facebook_ads_integration_settings.');
