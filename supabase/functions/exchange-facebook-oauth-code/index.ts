// POST { code, redirect_uri } — Super Admin / Admin only. Exchanges OAuth code for long-lived user token and saves access_token.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH_VERSION = "v21.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonRes(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function requireUserIdFromJwt(admin: ReturnType<typeof createClient>, jwt: string): Promise<string | null> {
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user?.id) return null;
  return userData.user.id;
}

async function isSuperAdminOrAdmin(admin: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { data: profile, error: profErr } = await admin.from("profiles").select("role_id").eq("id", userId).maybeSingle();
  if (profErr || !profile?.role_id) return false;
  const { data: roleRow, error: roleErr } = await admin.from("roles").select("name").eq("id", profile.role_id).maybeSingle();
  if (roleErr || !roleRow?.name) return false;
  return roleRow.name === "super_admin" || roleRow.name === "admin";
}

async function graphGetToken(params: Record<string, string>): Promise<{ access_token?: string; error?: { message?: string } }> {
  const u = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u.toString(), { method: "GET" });
  const json = (await res.json()) as { access_token?: string; error?: { message?: string } };
  if (!res.ok || json.error) {
    const msg = json.error?.message || `${res.status} token exchange failed`;
    throw new Error(msg);
  }
  return json;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  if (req.method !== "POST") {
    return jsonRes({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonRes({ error: "unauthorized", message: "Missing Authorization bearer token." }, 401);
  }
  const jwt = authHeader.slice(7).trim();
  if (!jwt) return jsonRes({ error: "unauthorized", message: "Empty bearer token." }, 401);

  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const userId = await requireUserIdFromJwt(admin, jwt);
    if (!userId) return jsonRes({ error: "unauthorized", message: "Invalid session." }, 401);

    if (!(await isSuperAdminOrAdmin(admin, userId))) {
      return jsonRes({ error: "forbidden", message: "Only Super Admin or Admin can connect Meta via OAuth." }, 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonRes({ error: "bad_request", message: "Invalid JSON body." }, 400);
    }

    const code = typeof body.code === "string" ? body.code.trim() : "";
    const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri.trim() : "";
    if (!code || !redirectUri) {
      return jsonRes({ error: "bad_request", message: "Provide code and redirect_uri from the OAuth redirect." }, 400);
    }
    if (redirectUri.length > 512) {
      return jsonRes({ error: "bad_request", message: "redirect_uri too long." }, 400);
    }

    const { data: row, error: rowErr } = await admin
      .from("facebook_ads_integration_settings")
      .select("fb_app_id, fb_app_secret, access_token")
      .eq("id", 1)
      .maybeSingle();

    if (rowErr) {
      console.error("[exchange-facebook-oauth-code] load settings", rowErr.message);
      return jsonRes({ error: "load_failed", message: rowErr.message }, 500);
    }

    const fromDbId = row?.fb_app_id != null ? String(row.fb_app_id).trim() : "";
    const fromDbSecret = row?.fb_app_secret != null ? String(row.fb_app_secret).trim() : "";
    const appId = fromDbId || Deno.env.get("FB_APP_ID")?.trim() || "";
    const appSecret = fromDbSecret || Deno.env.get("FB_APP_SECRET")?.trim() || "";

    if (!appId || !appSecret) {
      return jsonRes({
        error: "missing_app_credentials",
        message: "Save Meta App ID and App Secret in Settings (or set FB_APP_ID / FB_APP_SECRET secrets) before OAuth connect.",
      }, 400);
    }

    const shortJson = await graphGetToken({
      client_id: appId,
      redirect_uri: redirectUri,
      client_secret: appSecret,
      code,
    });
    const shortToken = shortJson.access_token;
    if (!shortToken || shortToken.length < 20) {
      return jsonRes({ error: "token_exchange_failed", message: "Facebook did not return a usable access token." }, 502);
    }

    let longToken = shortToken;
    try {
      const longJson = await graphGetToken({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      });
      if (longJson.access_token && longJson.access_token.length >= 20) {
        longToken = longJson.access_token;
      }
    } catch (e) {
      console.warn("[exchange-facebook-oauth-code] long-lived exchange skipped:", e instanceof Error ? e.message : e);
    }

    const persistAppId = row?.fb_app_id != null ? String(row.fb_app_id).trim() : "";
    const persistSecret = row?.fb_app_secret != null ? String(row.fb_app_secret).trim() : "";
    const next = {
      id: 1 as const,
      access_token: longToken,
      fb_app_id: persistAppId,
      fb_app_secret: persistSecret,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await admin.from("facebook_ads_integration_settings").upsert(next, { onConflict: "id" });
    if (upsertErr) {
      console.error("[exchange-facebook-oauth-code] upsert", upsertErr.message);
      return jsonRes({ error: "save_failed", message: upsertErr.message }, 500);
    }

    return jsonRes({
      ok: true,
      message: "Meta connected: access token saved for sync.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[exchange-facebook-oauth-code]", message);
    return jsonRes({ error: "internal_error", message }, 500);
  }
});
