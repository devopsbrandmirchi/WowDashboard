# fetch-facebook-campaigns

Syncs Facebook/Meta Ads campaign insights into Supabase (`facebook_campaigns_data`, `facebook_campaigns_reference_data`) using the Marketing API, similar to `sync-google-ads-data`.

## Required secrets (Supabase Edge Function secrets)

| Secret | Description |
|--------|-------------|
| `FB_APP_ID` | Meta App ID (e.g. 2768886193281642) |
| `FB_APP_SECRET` | Meta App Secret |
| `FB_ACCESS_TOKEN` | User or System User access token with `ads_read` (required for ad account data). Get from [Graph API Explorer](https://developers.facebook.com/tools/explorer/) or create a long-lived / System User token. |
| `FB_AD_ACCOUNT_ID` | Ad account ID with or without `act_` prefix (e.g. `act_123456789` or `123456789`) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set automatically in the Supabase Edge runtime.

## Invoke

- **Preferred:** `POST /functions/v1/fetch-facebook-campaigns-upsert` (Settings sync + daily cron).
- **Legacy:** `POST /functions/v1/fetch-facebook-campaigns` — same upsert write path (no delete window).
- **Cron:** Migration `20260719120000_fix_facebook_campaigns_sync_cron_to_upsert.sql` schedules daily sync at 03:00 UTC → upsert function.

## Data

- Fetches ad-level insights for the last ~2 full days (IST calendar, matching the daily spend email).
- Upserts into `facebook_campaigns_data` and inserts new campaign names into `facebook_campaigns_reference_data`.
