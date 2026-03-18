# fetch-reddit-campaigns

Syncs Reddit Ads campaign data into Supabase (`reddit_campaigns_ad_group`, `reddit_campaigns_reference_data`), similar to `fetch-facebook-campaigns` and `sync-google-ads-data`.

## Required secrets (Supabase Edge Function secrets)

| Secret | Description |
|--------|-------------|
| `REDDIT_CLIENT_ID` | Reddit app Client ID (from [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps)) |
| `REDDIT_CLIENT_SECRET` | Reddit app Client Secret |
| `REDDIT_REFRESH_TOKEN` | OAuth2 refresh token (use `duration=permanent` when authorizing to get a refresh token) |
| `REDDIT_ACCOUNT_ID` | Reddit Ads account ID |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set automatically in the Supabase Edge runtime.

## Invoke

- **HTTP:** `POST /functions/v1/fetch-reddit-campaigns` with `Authorization: Bearer <anon or service_role key>`.
- **Cron:** Optional migration `20250315110000_reddit_campaigns_sync_cron.sql` schedules daily sync at 04:00 UTC.

## Data

- Fetches report data for the last 2 days (yesterday and the day before) from Reddit Ads API.
- Inserts into `reddit_campaigns_ad_group` and new campaign names into `reddit_campaigns_reference_data`.
- **Note:** The Reddit Ads API report path and response shape may differ by version (v2/v3). If the default `/v2/accounts/{id}/report` fails, check [Reddit Ads API documentation](https://ads-api.reddit.com/docs) and update `reportPath` and `extractReportRows` in `index.ts` to match the current API.
