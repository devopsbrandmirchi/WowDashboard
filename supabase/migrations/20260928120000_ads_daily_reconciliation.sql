-- Per-day comparison written by each ad sync: platform campaign-level totals vs what the
-- dashboard sums from the stored rows. matched = false flags a day that needs attention.
create table if not exists public.ads_daily_reconciliation (
  platform text not null,
  account_id text not null,
  date date not null,
  api_cost numeric not null default 0,
  db_cost numeric not null default 0,
  api_impressions bigint not null default 0,
  db_impressions bigint not null default 0,
  api_clicks bigint not null default 0,
  db_clicks bigint not null default 0,
  matched boolean not null,
  checked_at timestamptz not null default now(),
  primary key (platform, account_id, date)
);

create index if not exists ads_daily_reconciliation_mismatch_idx
  on public.ads_daily_reconciliation (platform, date)
  where not matched;

alter table public.ads_daily_reconciliation enable row level security;

drop policy if exists "Authenticated select ads_daily_reconciliation" on public.ads_daily_reconciliation;
create policy "Authenticated select ads_daily_reconciliation"
  on public.ads_daily_reconciliation for select
  to authenticated
  using (true);
