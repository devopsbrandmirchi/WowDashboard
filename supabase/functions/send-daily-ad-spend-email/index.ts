// Sends one email per day with yesterday spend (USD) for Google, Meta, Reddit, Microsoft, TikTok.
//
// Google SMTP: set SMTP_USER / SMTP_PASS below, OR set the same names as Edge Function secrets (secrets win when in-file pass is empty — safe for deploy).
// Recipients: DAILY_SPEND_EMAIL_TO constant below; optional Edge secret DAILY_SPEND_EMAIL_TO overrides when set.
// Optional secret DAILY_SPEND_EMAIL_FROM overrides the default From header.
//
// App password: Google Account → Security → 2-Step Verification → App passwords. Paste below (spaces optional; stripped before login).
// Report "yesterday" uses Asia/Kolkata (IST) for the calendar date.
//
// Supabase (auto): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Requires migration: 20260505140000_daily_ad_spend_email_rpc_and_cron.sql
//
// Manual test: POST {} or POST {"report_date":"2026-05-04"}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { renderDailyAdSpendEmailHtml } from "./dailyAdSpendEmailTemplate.ts";

/** Calendar date for "yesterday" spend (DB dates are stored as calendar days; IST for your ops). */
const REPORT_TIMEZONE = "Asia/Kolkata";
/** Google Workspace / Gmail SMTP — edit here (do not push real passwords to public repositories). */
const SMTP_USER = "adops@chipperdigital.io";
/** 16-character app password; spaces are removed automatically. */
const SMTP_PASS = "lgrt vudh gcyj tzfu";
/** Primary recipient(s) for the daily digest (comma-separated). */
const DAILY_SPEND_EMAIL_TO = "koushik@brandmirchi.com";
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;
/** Implicit TLS; set true when using SMTP_PORT 465. */
const SMTP_SECURE = false;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLATFORM_ROWS: { key: keyof SpendJson; id: string; label: string; accent: string }[] = [
  { key: "google_ads", id: "google", label: "Google Ads", accent: "#4285F4" },
  { key: "meta_ads", id: "meta", label: "Meta Ads", accent: "#1877F2" },
  { key: "microsoft_ads", id: "microsoft", label: "Bing / Microsoft Ads", accent: "#00809D" },
  { key: "tiktok_ads", id: "tiktok", label: "TikTok Ads", accent: "#25F4EE" },
  { key: "reddit_ads", id: "reddit", label: "Reddit Ads", accent: "#FF4500" },
];

type SpendJson = {
  report_date: string;
  google_ads: number;
  meta_ads: number;
  reddit_ads: number;
  microsoft_ads: number;
  tiktok_ads: number;
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

/** Calendar YYYY-MM-DD in the given IANA time zone for `date`. */
function calendarDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Previous calendar day as YYYY-MM-DD (UTC date arithmetic on Y-M-D components). */
function previousCalendarDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map((x) => parseInt(x, 10));
  const u = new Date(Date.UTC(y, m - 1, d));
  u.setUTCDate(u.getUTCDate() - 1);
  return u.toISOString().slice(0, 10);
}

function defaultReportDate(): string {
  const now = new Date();
  const todayInIndia = calendarDateInTimeZone(now, REPORT_TIMEZONE);
  return previousCalendarDate(todayInIndia);
}

/** In-file constants, else Edge secrets (so app password is not required in git). */
function resolvedSmtpAuth(): { user: string; pass: string } {
  const user = SMTP_USER.trim() || Deno.env.get("SMTP_USER")?.trim() || "";
  const passInline = SMTP_PASS.replace(/\s+/g, "").trim();
  const passEnv = (Deno.env.get("SMTP_PASS") ?? "").replace(/\s+/g, "").trim();
  const pass = passInline || passEnv;
  return { user, pass };
}

async function sendViaSmtp(params: {
  from: string;
  to: string[];
  subject: string;
  html: string;
}): Promise<{ messageId?: string }> {
  const { user, pass } = resolvedSmtpAuth();
  if (!user || !pass) {
    throw new Error(
      "Missing SMTP credentials: set SMTP_USER + SMTP_PASS in this file, or set Edge secrets SMTP_USER and SMTP_PASS (Google App Password).",
    );
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from: params.from,
    to: params.to.join(", "),
    subject: params.subject,
    html: params.html,
  });

  return { messageId: info.messageId };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      return jsonRes({
        email_sent: false,
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      }, 500);
    }

    let body: { report_date?: string } = {};
    if (req.method === "POST") {
      try {
        body = await req.json() as { report_date?: string };
      } catch {
        body = {};
      }
    }

    const reportDate = (body.report_date && /^\d{4}-\d{2}-\d{2}$/.test(body.report_date))
      ? body.report_date
      : defaultReportDate();

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: raw, error: rpcError } = await supabase.rpc("get_daily_platform_spend_usd", {
      p_report_date: reportDate,
    });

    if (rpcError) {
      console.error("[send-daily-ad-spend-email] EMAIL NOT SENT — RPC error:", rpcError.message);
      return jsonRes({
        email_sent: false,
        ok: false,
        error: rpcError.message,
      }, 500);
    }

    const j = (raw ?? {}) as Record<string, unknown>;
    const spend: SpendJson = {
      report_date: String(j.report_date ?? reportDate),
      google_ads: num(j.google_ads),
      meta_ads: num(j.meta_ads),
      reddit_ads: num(j.reddit_ads),
      microsoft_ads: num(j.microsoft_ads),
      tiktok_ads: num(j.tiktok_ads),
    };

    const rows = PLATFORM_ROWS.map((r) => ({
      id: r.id,
      label: r.label,
      spend: num(spend[r.key]),
      accent: r.accent,
    }));
    const total = rows.reduce((s, r) => s + r.spend, 0);

    const toRaw = Deno.env.get("DAILY_SPEND_EMAIL_TO")?.trim() || DAILY_SPEND_EMAIL_TO.trim();
    if (!toRaw) {
      console.log("[send-daily-ad-spend-email] EMAIL NOT SENT — no recipients configured");
      return jsonRes({
        email_sent: false,
        ok: false,
        skipped: true,
        reason: "Set DAILY_SPEND_EMAIL_TO in this file or Edge secret DAILY_SPEND_EMAIL_TO.",
        report_date: spend.report_date,
        spend: { ...spend, total_all_platforms: total },
      }, 200);
    }
    const to = toRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (to.length === 0) {
      console.log("[send-daily-ad-spend-email] EMAIL NOT SENT — recipient list empty after parse");
      return jsonRes({
        email_sent: false,
        ok: false,
        error: "DAILY_SPEND_EMAIL_TO has no valid addresses",
      }, 400);
    }

    const { user: smtpMailbox } = resolvedSmtpAuth();
    const from = Deno.env.get("DAILY_SPEND_EMAIL_FROM")?.trim() ||
      (smtpMailbox ? `WowDashboard <${smtpMailbox}>` : "WowDashboard <noreply@localhost>");

    const html = renderDailyAdSpendEmailHtml({
      reportDate: spend.report_date,
      rows,
      total,
    });

    const subject = `Daily ad spend — ${spend.report_date} — ${new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(total)} total`;

    console.log("[send-daily-ad-spend-email] sending SMTP …", {
      report_date: spend.report_date,
      to,
      from,
    });
    const sent = await sendViaSmtp({ from, to, subject, html });
    console.log("[send-daily-ad-spend-email] EMAIL SENT OK", {
      smtp_message_id: sent.messageId ?? null,
      to,
    });

    return jsonRes({
      email_sent: true,
      ok: true,
      report_date: spend.report_date,
      smtp_message_id: sent.messageId ?? null,
      recipients: to,
      spend: { ...spend, total_all_platforms: total },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[send-daily-ad-spend-email] EMAIL NOT SENT —", msg);
    return jsonRes({ email_sent: false, ok: false, error: msg }, 500);
  }
});
