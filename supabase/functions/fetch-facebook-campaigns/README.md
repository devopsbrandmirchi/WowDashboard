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

- **HTTP:** `POST /functions/v1/fetch-facebook-campaigns` with `Authorization: Bearer <anon or service_role key>`.
- **Cron:** Optional migration `20250313120000_facebook_campaigns_sync_cron.sql` schedules daily sync at 03:00 UTC.

## Data

- Fetches ad-level insights for the last 2 days (yesterday and the day before).
- Inserts into `facebook_campaigns_data` and new campaign names into `facebook_campaigns_reference_data`.
