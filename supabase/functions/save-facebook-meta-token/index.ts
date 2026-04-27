// Meta/Facebook: GET status + app id hint (any auth user). POST merge row (Super Admin / Admin only).
// POST JSON (any subset): { access_token?: string, fb_app_id?: string, fb_app_secret?: string }.
// access_token: min 20 chars, or empty string to clear. fb_app_secret: omit or blank to keep existing.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

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
    if (req.method === "GET") {
      const userId = await requireUserIdFromJwt(admin, jwt);
      if (!userId) return jsonRes({ error: "unauthorized", message: "Invalid session." }, 401);

      const { data: row, error } = await admin
        .from("facebook_ads_integration_settings")
        .select("access_token, updated_at, fb_app_id, fb_app_secret")
        .eq("id", 1)
        .maybeSingle();

      if (error) {
        console.warn("[save-facebook-meta-token] GET", error.message);
        return jsonRes({
          ok: true,
          connected: false,
          updated_at: null,
          fb_app_id: "",
          has_app_secret: false,
        });
      }

      const tok = row?.access_token != null ? String(row.access_token).trim() : "";
      const connected = tok.length >= 20;
      const secret = row?.fb_app_secret != null ? String(row.fb_app_secret).trim() : "";
      const appId = row?.fb_app_id != null ? String(row.fb_app_id).trim() : "";
      return jsonRes({
        ok: true,
        connected,
        updated_at: connected && row?.updated_at ? String(row.updated_at) : null,
        fb_app_id: appId,
        has_app_secret: secret.length > 0,
      });
    }

    if (req.method !== "POST") {
      return jsonRes({ error: "method_not_allowed" }, 405);
    }

    const userId = await requireUserIdFromJwt(admin, jwt);
    if (!userId) return jsonRes({ error: "unauthorized", message: "Invalid session." }, 401);

    if (!(await isSuperAdminOrAdmin(admin, userId))) {
      return jsonRes({ error: "forbidden", message: "Only Super Admin or Admin can update Meta integration settings." }, 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonRes({ error: "bad_request", message: "Invalid JSON body." }, 400);
    }

    const secretInBody = typeof body.fb_app_secret === "string" && body.fb_app_secret.trim().length > 0;
    const touched =
      "access_token" in body ||
      "fb_app_id" in body ||
      secretInBody;
    if (!touched) {
      return jsonRes(
        { error: "bad_request", message: "Provide access_token, fb_app_id, and/or a non-empty fb_app_secret." },
        400
      );
    }

    const { data: existing, error: loadErr } = await admin
      .from("facebook_ads_integration_settings")
      .select("access_token, fb_app_id, fb_app_secret")
      .eq("id", 1)
      .maybeSingle();

    if (loadErr) {
      console.error("[save-facebook-meta-token] load", loadErr.message);
      return jsonRes({ error: "save_failed", message: loadErr.message }, 500);
    }

    const next = {
      id: 1 as const,
      access_token: existing?.access_token != null ? String(existing.access_token) : "",
      fb_app_id: existing?.fb_app_id != null ? String(existing.fb_app_id) : "",
      fb_app_secret: existing?.fb_app_secret != null ? String(existing.fb_app_secret) : "",
      updated_at: new Date().toISOString(),
    };

    if ("access_token" in body) {
      const t = typeof body.access_token === "string" ? body.access_token.trim() : "";
      if (t.length > 0 && t.length < 20) {
        return jsonRes(
          { error: "bad_request", message: "access_token must be at least 20 characters, or empty to clear." },
          400
        );
      }
      next.access_token = t;
    }

    if ("fb_app_id" in body) {
      next.fb_app_id = typeof body.fb_app_id === "string" ? body.fb_app_id.trim() : "";
    }

    if (secretInBody) {
      next.fb_app_secret = String(body.fb_app_secret).trim();
    }

    const { error: upsertErr } = await admin.from("facebook_ads_integration_settings").upsert(next, { onConflict: "id" });

    if (upsertErr) {
      console.error("[save-facebook-meta-token]", upsertErr.message);
      return jsonRes(
        {
          error: "save_failed",
          message: upsertErr.message.includes("facebook_ads_integration_settings")
            ? "Database migration may be missing. Apply facebook_ads_integration_settings migrations."
            : upsertErr.message,
        },
        500
      );
    }

    return jsonRes({
      ok: true,
      message: "Meta integration settings saved. Syncs read app credentials from this row before FB_APP_ID / FB_APP_SECRET secrets.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[save-facebook-meta-token]", message);
    return jsonRes({ error: "internal_error", message }, 500);
  }
});
