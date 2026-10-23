-- Arzish hosted edition: core schema, row-level security, sign-up trigger and seeds.
-- Every table in public has RLS on. Writes that cross users (market data, notifications,
-- billing, admin) happen only in edge functions with the secret key.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------- settings and roles
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  public boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  referral_code text unique default substr(md5(gen_random_uuid()::text), 1, 8),
  referred_by uuid references public.profiles (id) on delete set null,
  marketing_opt_in boolean not null default false,
  disabled boolean not null default false,
  ai_reset_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and not p.disabled
  );
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------- user data
create table public.workspaces (
  user_id uuid primary key references auth.users (id) on delete cascade,
  ws jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  constraint ws_size check (octet_length(ws::text) < 1000000)
);

create table public.portfolio_snapshots (
  user_id uuid not null references auth.users (id) on delete cascade,
  portfolio_id text not null,
  d date not null,
  value_pkr numeric not null,
  cost_pkr numeric,
  data jsonb,
  primary key (user_id, portfolio_id, d)
);

-- ---------------------------------------------------------------- market data
create table public.market_docs (
  id text primary key check (id in ('latest', 'psx', 'funds')),
  doc jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.market_patches (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source text not null default 'agent',
  patch jsonb not null,
  note text
);

create table public.market_events (
  id bigint generated always as identity primary key,
  kind text not null,
  d date not null default current_date,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.price_history (
  kind text not null check (kind in ('psx', 'fund', 'index')),
  code text not null,
  d date not null,
  v numeric not null,
  primary key (kind, code, d)
);

create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  info jsonb
);
create index job_runs_job_idx on public.job_runs (job, ran_at desc);

-- ---------------------------------------------------------------- notifications
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  data jsonb,
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  emailed_at timestamptz,
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  prefs jsonb not null default '{}',
  digest text not null default 'weekly' check (digest in ('weekly', 'off')),
  zakat_date text check (zakat_date is null or zakat_date ~ '^[0-1][0-9]-[0-3][0-9]$'),
  unsubscribe_token uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);

create table public.alert_rules (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('price_move', 'price_target', 'drawdown')),
  params jsonb not null,
  active boolean not null default true,
  last_fired_at timestamptz,
  created_at timestamptz not null default now()
);
create index alert_rules_user_idx on public.alert_rules (user_id);

-- ---------------------------------------------------------------- billing
create table public.plans (
  id text primary key,
  name text not null,
  price_pkr_month int,
  price_pkr_year int,
  price_usd_month numeric,
  price_usd_year numeric,
  limits jsonb not null default '{}',
  features jsonb not null default '[]',
  safepay_plan_month text,
  safepay_plan_year text,
  public boolean not null default true,
  sort int not null default 0
);

create table public.subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  interval text check (interval in ('month', 'year')),
  source text not null check (source in ('trial', 'safepay', 'admin', 'coupon', 'referral')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  provider_ref text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_user_idx on public.subscriptions (user_id, created_at desc);
create index subscriptions_ref_idx on public.subscriptions (provider_ref);

create table public.payments (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  subscription_id bigint references public.subscriptions (id) on delete set null,
  plan_id text,
  interval text,
  amount numeric,
  currency text,
  provider text not null default 'safepay',
  provider_ref text,
  status text not null check (status in ('pending', 'paid', 'failed', 'refunded')),
  raw jsonb,
  created_at timestamptz not null default now()
);
create index payments_user_idx on public.payments (user_id, created_at desc);

create table public.coupons (
  code text primary key check (code = upper(code)),
  kind text not null check (kind in ('pro_days')),
  value int not null check (value > 0 and value <= 3660),
  max_redemptions int,
  redeemed int not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

create table public.coupon_redemptions (
  user_id uuid not null references auth.users (id) on delete cascade,
  code text not null references public.coupons (code) on delete cascade,
  at timestamptz not null default now(),
  primary key (user_id, code)
);

-- ---------------------------------------------------------------- AI, messages, admin
create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric,
  feature text
);
create index ai_usage_user_idx on public.ai_usage (user_id, at desc);

create table public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  email text,
  kind text not null default 'idea' check (kind in ('bug', 'idea', 'question', 'billing')),
  message text not null check (char_length(message) between 1 and 4000),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.announcements (
  id bigint generated always as identity primary key,
  title text not null,
  body text,
  link text,
  audience text not null default 'all' check (audience in ('all', 'free', 'paid')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  emailed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  target_type text,
  target_id text,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create table public.email_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  to_email text,
  kind text not null,
  subject text,
  provider_id text,
  status text not null check (status in ('sent', 'failed', 'delivered', 'bounced', 'complained', 'skipped')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_log_created_idx on public.email_log (created_at desc);

create table public.auth_codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_count int not null default 1,
  window_start timestamptz not null default now(),
  last_sent_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- row-level security
alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.portfolio_snapshots enable row level security;
alter table public.market_docs enable row level security;
alter table public.market_patches enable row level security;
alter table public.market_events enable row level security;
alter table public.price_history enable row level security;
alter table public.job_runs enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.alert_rules enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.ai_usage enable row level security;
alter table public.feedback enable row level security;
alter table public.announcements enable row level security;
alter table public.audit_log enable row level security;
alter table public.email_log enable row level security;
alter table public.auth_codes enable row level security;

-- Settings: public keys for everyone, the rest for admins.
create policy settings_read on public.app_settings for select to anon, authenticated
  using (public or (select public.is_admin()));

-- Profiles: own row; admins read all. Column grants stop users changing role or status.
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, marketing_opt_in, last_seen_at) on public.profiles to authenticated;

-- Workspaces and snapshots: own rows only.
create policy workspaces_own on public.workspaces for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy snapshots_own on public.portfolio_snapshots for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Market data: readable by everyone, written only by the server.
create policy market_docs_read on public.market_docs for select to anon, authenticated using (true);
create policy price_history_read on public.price_history for select to anon, authenticated using (true);
create policy market_events_read on public.market_events for select to authenticated using (true);
create policy job_runs_admin on public.job_runs for select to authenticated using ((select public.is_admin()));
create policy market_patches_admin on public.market_patches for select to authenticated using ((select public.is_admin()));

-- Notifications: read and mark read your own.
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_mark on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy prefs_own on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- The unsubscribe token is set by the server only.
revoke insert, update on public.notification_prefs from anon, authenticated;
grant insert (user_id, prefs, digest, zakat_date, updated_at) on public.notification_prefs to authenticated;
grant update (prefs, digest, zakat_date, updated_at) on public.notification_prefs to authenticated;
create policy alert_rules_own on public.alert_rules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Billing: plans are public; users see their own subscriptions and payments.
create policy plans_read on public.plans for select to anon, authenticated using (public or (select public.is_admin()));
create policy subscriptions_read on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy payments_read on public.payments for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy coupons_admin on public.coupons for select to authenticated using ((select public.is_admin()));
create policy redemptions_read on public.coupon_redemptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- AI usage: users see their own counts; admins see all.
create policy ai_usage_read on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Feedback: users send and read their own; admins read all.
create policy feedback_insert on public.feedback for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy feedback_read on public.feedback for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
revoke update, delete on public.feedback from anon, authenticated;

-- Announcements: live ones for signed-in users; all for admins.
create policy announcements_read on public.announcements for select to authenticated
  using ((starts_at <= now() and (ends_at is null or ends_at > now())) or (select public.is_admin()));

-- Admin-only reads.
create policy audit_admin on public.audit_log for select to authenticated using ((select public.is_admin()));
create policy email_log_admin on public.email_log for select to authenticated using ((select public.is_admin()));
-- auth_codes: no policies at all (server only).

-- ---------------------------------------------------------------- entitlements
-- The plan in force for a user: the best live subscription, else Free.
create or replace function public.plan_for(uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select s.*, p.sort, p.limits, p.name as plan_name
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.user_id = uid
      and s.status in ('trialing', 'active', 'past_due')
      and (s.current_period_end is null
           or s.current_period_end > now() - case when s.status = 'past_due' then interval '3 days' else interval '0' end)
    order by p.sort desc, s.current_period_end desc nulls first
    limit 1
  )
  select coalesce(
    (select jsonb_build_object(
       'plan', l.plan_id, 'name', l.plan_name, 'status', l.status, 'source', l.source,
       'interval', l.interval, 'periodEnd', l.current_period_end, 'cancelAtPeriodEnd', l.cancel_at_period_end,
       'limits', l.limits)
     from live l),
    (select jsonb_build_object('plan', p.id, 'name', p.name, 'status', 'free', 'limits', p.limits)
     from public.plans p where p.id = 'free')
  );
$$;
revoke execute on function public.plan_for(uuid) from public, anon, authenticated;
grant execute on function public.plan_for(uuid) to service_role;

create or replace function public.my_plan()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.plan_for((select auth.uid()));
$$;
revoke execute on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- AI questions used this month (since the start of the month or the last admin reset).
create or replace function public.ai_used(uid uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.ai_usage u
  where u.user_id = uid
    and u.at >= greatest(date_trunc('month', now()), coalesce((select ai_reset_at from public.profiles where id = uid), '-infinity'::timestamptz))
    and coalesce(u.feature, 'chat') <> 'tool-loop';
$$;
revoke execute on function public.ai_used(uuid) from public, anon, authenticated;
grant execute on function public.ai_used(uuid) to service_role;

create or replace function public.my_ai_used()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select public.ai_used((select auth.uid()));
$$;
revoke execute on function public.my_ai_used() from public, anon;
grant execute on function public.my_ai_used() to authenticated;

-- ---------------------------------------------------------------- new users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admins jsonb;
  trial_days int;
begin
  select value into admins from public.app_settings where key = 'admin_emails';
  select coalesce((value #>> '{}')::int, 14) into trial_days from public.app_settings where key = 'trial_days';
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    case when admins is not null and admins ? lower(coalesce(new.email, '')) then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  insert into public.notification_prefs (user_id) values (new.id) on conflict do nothing;
  if coalesce(trial_days, 14) > 0 then
    insert into public.subscriptions (user_id, plan_id, status, source, current_period_start, current_period_end, note)
    values (new.id, 'pro', 'trialing', 'trial', now(), now() + make_interval(days => coalesce(trial_days, 14)), 'Sign-up trial');
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- seeds
-- admin_emails: accounts created with these addresses become admins. Put your own address here
-- before running this on a new project (the live project already has it set).
insert into public.app_settings (key, value, public) values
  ('admin_emails', '["admin@example.com"]', false),
  ('trial_days', '14', true),
  ('support_email', '""', true),
  ('ai_model', '"claude-opus-5-5"', false),
  ('email_from', '"Arzish <onboarding@resend.dev>"', false),
  ('app_url', '""', true),
  ('payments_enabled', 'false', true);

insert into public.plans (id, name, price_pkr_month, price_pkr_year, price_usd_month, price_usd_year, limits, features, public, sort) values
  ('free', 'Free', 0, 0, 0, 0,
   '{"portfolios":1,"holdings":25,"goals":2,"ai_month":5,"email_alerts":false,"pro_screens":false,"import":false,"alerts":3}',
   '["1 portfolio and 25 holdings","Daily PSX prices and fund NAVs","Forecasts and 2 goals","Risk overview","In-app alerts and the weekly digest","5 AI questions a month"]',
   true, 0),
  ('pro', 'Pro', 999, 9999, 4.99, 49,
   '{"portfolios":20,"holdings":1000,"goals":50,"ai_month":100,"email_alerts":true,"pro_screens":true,"import":true,"alerts":50}',
   '["Unlimited portfolios and holdings","Stress tests, optimizer, tax and zakat","Every alert by email","Performance tracking","100 AI questions a month","AI statement import","CSV and report exports"]',
   true, 10),
  ('family', 'Family', 1999, 19999, 9.99, 99,
   '{"portfolios":40,"holdings":2000,"goals":100,"ai_month":200,"email_alerts":true,"pro_screens":true,"import":true,"alerts":100,"members":4}',
   '["Pro for up to 4 people","Household view"]',
   false, 20),
  ('advisor', 'Advisor', 4999, 49999, 24.99, 249,
   '{"portfolios":50,"holdings":5000,"goals":200,"ai_month":300,"email_alerts":true,"pro_screens":true,"import":true,"alerts":200,"clients":50}',
   '["Up to 50 client portfolios","Branded client reports"]',
   false, 30);
