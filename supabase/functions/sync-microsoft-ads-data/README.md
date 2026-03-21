# sync-microsoft-ads-data

**Parallel:** [`sync-google-ads-data`](../sync-google-ads-data/index.ts) — fetch from the API and **replace** rows for the default window with **delete + insert**. Does **not** write `microsoft_ads_sync_by_date` or `ads_sync_by_date_log`.

**Bundling:** Microsoft reporting helpers live in **`microsoft_ads_reporting.ts`** next to `index.ts` (Supabase only uploads each function folder—no `../_shared` imports).

Use for **cron** or one-shot reloads. For **user-chosen date ranges** and **audit logging**, use [`sync-microsoft-ads-upsert`](../sync-microsoft-ads-upsert/index.ts) (same pattern as `sync-google-ads-upsert`).

## Secrets

Same Microsoft + Supabase secrets as `sync-microsoft-ads-upsert` (see that README).

## Behavior

- **GET** or **POST** (no body required).
- Date range: **last 2 UTC days** (same default as `sync-google-ads-data`), not configurable in this function.

## Deploy

```bash
supabase functions deploy sync-microsoft-ads-data --no-verify-jwt
```
