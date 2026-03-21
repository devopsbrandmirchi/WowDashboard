# sync-microsoft-ads-upsert

**Parallel:** [`sync-google-ads-upsert`](../sync-google-ads-upsert/index.ts) — **upsert** rows, update **`microsoft_ads_sync_by_date`**, append **`ads_sync_by_date_log`**. Accepts **`date_from` / `date_to`** (optional; default last 2 UTC days).

**Bundling:** Helpers are in **`microsoft_ads_reporting.ts`** in this folder (same file is duplicated in `sync-microsoft-ads-data` and `fetch-microsoft-ads`—keep them in sync when editing).

For **cron** or **delete+insert** reload without audit tables, use [`sync-microsoft-ads-data`](../sync-microsoft-ads-data/index.ts) (same relationship as `sync-google-ads-data`).

**JSON-only** API (no DB): [`fetch-microsoft-ads`](../fetch-microsoft-ads/index.ts).

## Required secrets (Supabase → Edge Functions → Secrets)

| Secret | Description |
|--------|-------------|
| `MICROSOFT_ADS_CLIENT_ID` | Azure app (Microsoft Entra) application (client) ID |
| `MICROSOFT_ADS_CLIENT_SECRET` | Client secret value |
| `MICROSOFT_ADS_REFRESH_TOKEN` | Refresh token with `offline_access` and Microsoft Ads scope |
| `MICROSOFT_ADS_DEVELOPER_TOKEN` | Developer token (Microsoft Advertising → Developer settings) |
| `MICROSOFT_ADS_CUSTOMER_ID` | Customer (manager) ID |
| `MICROSOFT_ADS_ACCOUNT_ID` | Ad account ID to report on |

Also: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Invoke

`POST` body (optional):

```json
{ "date_from": "2025-03-01", "date_to": "2025-03-20" }
```

**From the app:** White-Label Settings → Bing / Microsoft Ads → Sync.

## Database

Migration `20250321120000_microsoft_ads_tables.sql`.

## Deploy

```bash
supabase functions deploy sync-microsoft-ads-upsert --no-verify-jwt
```
