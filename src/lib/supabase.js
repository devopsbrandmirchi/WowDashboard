import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
/** Legacy anon JWT (starts with eyJ) — Edge Function gateway requires a real JWT in Authorization; sb_publishable_* is not a JWT. */
const supabaseLegacyAnonJwt = import.meta.env.VITE_SUPABASE_LEGACY_ANON_JWT || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase env missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
  );
}

/**
 * Bearer token for Edge Function gateway (not used by our sync handlers for auth — they use service role).
 * Prefer legacy anon JWT when set: user access tokens are often ES256 and the Edge gateway still returns
 * 401 "Invalid JWT" for them even after a successful refresh; legacy anon (eyJ… HS256) matches working curl.
 * Never use sb_publishable_* as Bearer.
 */
function bearerTokenForEdgeFunctions(sessionAccessToken) {
  if (supabaseLegacyAnonJwt) return supabaseLegacyAnonJwt;
  if (sessionAccessToken) return sessionAccessToken;
  if (supabaseAnonKey?.startsWith('eyJ')) return supabaseAnonKey;
  return '';
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

/**
 * Invoke an Edge Function via plain fetch (same as curl in supabase/functions/curl.text).
 * supabase.functions.invoke goes through the client's fetchWithAuth + FunctionsClient merge;
 * that path has repeatedly produced 401 Invalid JWT even with correct tokens. Direct fetch
 * sets only apikey + Authorization and matches the working CLI request.
 *
 * @param {object} [options] - `{ method?: 'GET'|'POST', signal?, headers? }` — GET sends no body.
 */
export async function invokeEdgeFunction(functionName, body, options = {}) {
  const { method = 'POST', signal, headers: extraHeaders } = options;
  const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
  if (refreshErr && import.meta.env.DEV) {
    console.warn('[invokeEdgeFunction] refreshSession:', refreshErr.message);
  }
  const { data: { session } = {} } = await supabase.auth.getSession();
  const sessionToken = refreshed?.session?.access_token ?? session?.access_token ?? null;
  const bearer = bearerTokenForEdgeFunctions(sessionToken);
  if (!bearer) {
    const msg =
      'Missing JWT for Edge Functions. Add VITE_SUPABASE_LEGACY_ANON_JWT (legacy anon eyJ… from Supabase Dashboard → API) when using a publishable anon key.';
    if (import.meta.env.DEV) console.error('[invokeEdgeFunction]', msg);
    return {
      data: null,
      error: new Error(msg),
      response: undefined,
    };
  }
  if (
    import.meta.env.DEV &&
    !sessionToken &&
    supabaseAnonKey?.startsWith('sb_publishable_') &&
    !supabaseLegacyAnonJwt
  ) {
    console.warn(
      '[invokeEdgeFunction] VITE_SUPABASE_ANON_KEY is publishable-only; set VITE_SUPABASE_LEGACY_ANON_JWT for Edge Function calls, or redeploy with --no-verify-jwt.'
    );
  }

  const base = (supabaseUrl || '').replace(/\/+$/, '');
  const url = `${base}/functions/v1/${encodeURIComponent(functionName)}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(extraHeaders || {}),
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${bearer}`,
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      signal,
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const msg =
        parsed && typeof parsed === 'object' && parsed !== null && 'message' in parsed
          ? String(parsed.message)
          : typeof parsed === 'string' && parsed
            ? parsed
            : `${res.status} ${res.statusText}`;
      return { data: null, error: new Error(msg), response: res };
    }
    return { data: parsed, error: null, response: res };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { data: null, error: err, response: undefined };
  }
}
