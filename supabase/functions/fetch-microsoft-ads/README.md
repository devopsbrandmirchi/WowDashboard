# fetch-microsoft-ads

**Bundling:** `microsoft_ads_reporting.ts` is colocated here (duplicated in `sync-microsoft-ads-data` / `sync-microsoft-ads-upsert`) because Supabase Edge deploy bundles per function folder only.

Fetches **Microsoft Advertising** ad-group daily metrics and returns them as **JSON** — **no database writes**.

Use this to verify credentials, inspect API output, or pipe data elsewhere. For syncing into Supabase, use **`sync-microsoft-ads-upsert`** (Settings UI) or **`sync-microsoft-ads-data`** (cron-style delete+insert, no audit log)—same split as `sync-google-ads-upsert` vs `sync-google-ads-data`.

## Secrets

Same Microsoft env vars as `sync-microsoft-ads-upsert` (see that README). You do **not** need `SUPABASE_SERVICE_ROLE_KEY` for this function.

## Request

**GET** query params:

- `date_from`, `date_to` — optional ISO dates (`YYYY-MM-DD`); default ≈ last 2 UTC days
- `limit` — max rows in `rows` (default `500`, max `5000`)

**POST** JSON body:

```json
{
  "date_from": "2025-03-01",
  "date_to": "2025-03-15",
  "limit": 200
}
```

## Response

```json
{
  "ok": true,
  "function": "fetch-microsoft-ads",
  "account_id": "...",
  "date_from": "...",
  "date_to": "...",
  "row_count": 1200,
  "limit": 500,
  "truncated": true,
  "rows": [ ... ]
}
```

## Deploy

```bash
supabase functions deploy fetch-microsoft-ads --no-verify-jwt
```
