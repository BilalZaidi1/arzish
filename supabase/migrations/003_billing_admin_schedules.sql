-- Arzish 003: card checkout and payment events, back-office read functions, AI cost settings,
-- realtime notifications and the job schedule.

-- ---------------------------------------------------------------- billing
-- A checkout started in the app; Safepay echoes the token back as the subscription reference.
create table public.checkout_sessions (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references public.plans (id),
  interval text not null check (interval in ('month', 'year')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  subscription_ref text
);
create index checkout_sessions_user_idx on public.checkout_sessions (user_id, created_at desc);
create index checkout_sessions_plan_idx on public.checkout_sessions (plan_id);
alter table public.checkout_sessions enable row level security;
create policy checkout_read on public.checkout_sessions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Every payment-provider event as received, for support and debugging.
create table public.billing_events (
  id bigint generated always as identity primary key,
  provider text not null,
  type text,
  data jsonb,
  signature_ok boolean not null default false,
  processed boolean not null default false,
  result jsonb,
  error text,
  received_at timestamptz not null default now()
);
alter table public.billing_events enable row level security;
create policy billing_events_admin on public.billing_events for select to authenticated using ((select public.is_admin()));

create unique index payments_provider_ref_uidx on public.payments (provider, provider_ref) where provider_ref is not null;

-- Foreign-key indexes.
create index if not exists coupon_redemptions_code_idx on public.coupon_redemptions (code);
create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc);
create index if not exists payments_subscription_idx on public.payments (subscription_id);
create index if not exists profiles_referred_by_idx on public.profiles (referred_by);
create index if not exists announcements_created_by_idx on public.announcements (created_by);
create index if not exists email_log_user_idx on public.email_log (user_id, created_at desc);
create index if not exists subscriptions_plan_idx on public.subscriptions (plan_id);
create index if not exists profiles_email_idx on public.profiles (email);

-- ---------------------------------------------------------------- settings and plan limits
insert into public.app_settings (key, value, public) values
  ('ai_enabled', 'true', true),
  ('ai_model_quick', '"claude-opus-5-5"', false),
  ('ai_price', '{"claude-opus-5-5":{"in":4,"out":20,"cw":5,"cr":0.2},"claude-sonnet-5-5":{"in":2,"out":10,"cw":2.5,"cr":0.1},"claude-haiku-5-5":{"in":0.1,"out":0.5,"cw":0.125,"cr":0.01}}', false),
  ('safepay_env', '"sandbox"', false),
  ('referral_reward_days', '30', true)
on conflict (key) do nothing;

-- A monthly AI cost cap per plan (US dollars) on top of the question allowance.
update public.plans set limits = limits || jsonb_build_object('ai_usd_month',
  case id when 'free' then 0.5 when 'pro' then 5 when 'family' then 10 else 25 end);

-- ---------------------------------------------------------------- realtime inbox
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

-- ---------------------------------------------------------------- back-office reads (admins only)
create or replace function public.admin_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  with live as (
    select distinct on (s.user_id) s.user_id, s.plan_id, s.status, s.source, s.interval
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.status in ('trialing', 'active', 'past_due')
      and (s.current_period_end is null or s.current_period_end > now() - case when s.status = 'past_due' then interval '3 days' else interval '0' end)
    order by s.user_id, p.sort desc, s.current_period_end desc nulls first
  )
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'disabled', (select count(*) from public.profiles where disabled),
    'new7', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'new30', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'active1', (select count(*) from public.profiles where last_seen_at > now() - interval '1 day'),
    'active7', (select count(*) from public.profiles where last_seen_at > now() - interval '7 days'),
    'active30', (select count(*) from public.profiles where last_seen_at > now() - interval '30 days'),
    'withPortfolio', (select count(*) from public.workspaces),
    'trialing', (select count(*) from live where status = 'trialing'),
    'paying', (select count(*) from live where source = 'safepay' and status in ('active', 'past_due')),
    'manual', (select count(*) from live where source = 'admin' and status = 'active'),
    'granted', (select count(*) from live where source in ('coupon', 'referral')),
    'pastDue', (select count(*) from live where status = 'past_due'),
    'byPlan', (select coalesce(jsonb_object_agg(plan_id, n), '{}') from (select plan_id, count(*) as n from live group by plan_id) x),
    'mrrPkr', (select coalesce(round(sum(case when l.interval = 'year' then p.price_pkr_year / 12.0 else p.price_pkr_month end)), 0)
               from live l join public.plans p on p.id = l.plan_id
               where l.source in ('safepay', 'admin') and l.status in ('active', 'past_due')),
    'revenue30', (select coalesce(jsonb_object_agg(currency, total), '{}') from (
                   select coalesce(currency, 'PKR') as currency, sum(amount) as total from public.payments
                   where status = 'paid' and created_at > now() - interval '30 days' group by 1) x),
    'ai30', (select jsonb_build_object(
               'questions', count(*) filter (where coalesce(feature, 'chat') <> 'tool-loop'),
               'calls', count(*),
               'cost', round(coalesce(sum(cost_usd), 0)::numeric, 2),
               'users', count(distinct user_id))
             from public.ai_usage where at > now() - interval '30 days'),
    'emails7', (select jsonb_build_object(
                  'sent', count(*) filter (where status in ('sent', 'delivered')),
                  'failed', count(*) filter (where status in ('failed', 'bounced', 'complained')),
                  'skipped', count(*) filter (where status = 'skipped'))
                from public.email_log where created_at > now() - interval '7 days'),
    'feedbackOpen', (select count(*) from public.feedback where status = 'open'),
    'notifications7', (select count(*) from public.notifications where created_at > now() - interval '7 days'),
    'billingErrors7', (select count(*) from public.billing_events where received_at > now() - interval '7 days' and (not signature_ok or error is not null)),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('job', j.job, 'ranAt', j.ran_at, 'ok', j.ok, 'info', j.info) order by j.job), '[]')
             from (select distinct on (job) job, ran_at, ok, info from public.job_runs order by job, ran_at desc) j),
    'market', (select coalesce(jsonb_object_agg(id, jsonb_build_object('updatedAt', updated_at, 'builtAt', doc ->> 'builtAt', 'asOf', coalesce(doc ->> 'asOf', doc #>> '{market,asOf}'), 'review', doc -> 'review')), '{}')
               from public.market_docs)
  ) into r;
  return r;
end;
$$;

-- Daily series for the dashboard charts.
create or replace function public.admin_series(days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'd', d::date,
      'signups', (select count(*) from public.profiles p where p.created_at >= d and p.created_at < d + interval '1 day'),
      'questions', (select count(*) from public.ai_usage u where u.at >= d and u.at < d + interval '1 day' and coalesce(u.feature, 'chat') <> 'tool-loop'),
      'aiCost', (select round(coalesce(sum(u.cost_usd), 0)::numeric, 3) from public.ai_usage u where u.at >= d and u.at < d + interval '1 day'),
      'emails', (select count(*) from public.email_log e where e.created_at >= d and e.created_at < d + interval '1 day' and e.status in ('sent', 'delivered'))
    ) order by d), '[]')
    from generate_series(date_trunc('day', now()) - make_interval(days => greatest(1, least(days, 180)) - 1), date_trunc('day', now()), interval '1 day') as d
  );
end;
$$;

-- User list with plan and usage; plans are worked out for the page only.
create or replace function public.admin_users(q text default '', lim int default 50, off int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  term text := coalesce(trim(q), '');
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    with filtered as (
      select p.* from public.profiles p
      where term = '' or p.email ilike '%' || term || '%' or coalesce(p.full_name, '') ilike '%' || term || '%' or p.id::text = term
    ),
    page as (
      select * from filtered order by created_at desc limit greatest(1, least(lim, 200)) offset greatest(off, 0)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pg.id, 'email', pg.email, 'name', pg.full_name, 'role', pg.role, 'disabled', pg.disabled,
        'createdAt', pg.created_at, 'lastSeenAt', pg.last_seen_at,
        'plan', public.plan_for(pg.id),
        'aiMonth', public.ai_used(pg.id),
        'hasWorkspace', exists (select 1 from public.workspaces w where w.user_id = pg.id)
      ) order by pg.created_at desc) from page pg), '[]')
    )
  );
end;
$$;

-- One user's account, billing and usage. Holdings stay private: only counts are shown.
create or replace function public.admin_user_detail(uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'profile', to_jsonb(p) - 'referral_code' || jsonb_build_object('referralCode', p.referral_code),
      'referredBy', (select r.email from public.profiles r where r.id = p.referred_by),
      'referrals', (select count(*) from public.profiles r where r.referred_by = p.id),
      'plan', public.plan_for(p.id),
      'subscriptions', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc) from public.subscriptions s where s.user_id = p.id), '[]'),
      'payments', coalesce((select jsonb_agg(to_jsonb(x) - 'raw' order by x.created_at desc) from public.payments x where x.user_id = p.id), '[]'),
      'ai', jsonb_build_object(
        'month', public.ai_used(p.id),
        'monthCost', (select round(coalesce(sum(u.cost_usd), 0)::numeric, 3) from public.ai_usage u where u.user_id = p.id and u.at >= greatest(date_trunc('month', now()), coalesce(p.ai_reset_at, '-infinity'::timestamptz))),
        'total', (select count(*) from public.ai_usage u where u.user_id = p.id and coalesce(u.feature, 'chat') <> 'tool-loop'),
        'totalCost', (select round(coalesce(sum(u.cost_usd), 0)::numeric, 3) from public.ai_usage u where u.user_id = p.id)),
      'workspace', (select jsonb_build_object(
          'updatedAt', w.updated_at,
          'bytes', octet_length(w.ws::text),
          'portfolios', (select count(*) from jsonb_array_elements(coalesce(w.ws -> 'portfolios', '[]')) e where coalesce((e ->> 'isExample')::boolean, false) = false),
          'holdings', (select coalesce(sum(jsonb_array_length(coalesce(e -> 'holdings', '[]'))), 0) from jsonb_array_elements(coalesce(w.ws -> 'portfolios', '[]')) e where coalesce((e ->> 'isExample')::boolean, false) = false),
          'goals', (select coalesce(sum(jsonb_array_length(coalesce(e -> 'goals', '[]'))), 0) from jsonb_array_elements(coalesce(w.ws -> 'portfolios', '[]')) e where coalesce((e ->> 'isExample')::boolean, false) = false))
        from public.workspaces w where w.user_id = p.id),
      'prefs', (select jsonb_build_object('digest', n.digest, 'zakatDate', n.zakat_date) from public.notification_prefs n where n.user_id = p.id),
      'alerts', (select count(*) from public.alert_rules a where a.user_id = p.id and a.active),
      'unread', (select count(*) from public.notifications n where n.user_id = p.id and n.read_at is null),
      'feedback', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from (select * from public.feedback f where f.user_id = p.id order by created_at desc limit 20) f), '[]'),
      'emails', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'kind', e.kind, 'subject', e.subject, 'status', e.status, 'error', e.error) order by e.created_at desc) from (select * from public.email_log e where e.user_id = p.id order by created_at desc limit 20) e), '[]'),
      'audit', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'actor', (select ap.email from public.profiles ap where ap.id = a.actor), 'after', a.after) order by a.at desc) from (select * from public.audit_log a where a.target_id = p.id::text or a.actor = p.id order by at desc limit 30) a), '[]')
    )
    from public.profiles p where p.id = uid
  );
end;
$$;

revoke execute on function public.admin_metrics() from public, anon;
revoke execute on function public.admin_series(int) from public, anon;
revoke execute on function public.admin_users(text, int, int) from public, anon;
revoke execute on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_metrics() to authenticated;
grant execute on function public.admin_series(int) to authenticated;
grant execute on function public.admin_users(text, int, int) to authenticated;
grant execute on function public.admin_user_detail(uuid) to authenticated;

-- ---------------------------------------------------------------- jobs
-- Give scheduled calls the whole edge-function time limit.
create or replace function public.invoke_function(fn text, body jsonb default '{}'::jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := body,
    timeout_milliseconds := 150000
  );
$$;
revoke execute on function public.invoke_function(text, jsonb) from public, anon, authenticated;

-- Times are UTC (Pakistan is UTC+5).
-- 08:50 PKT: load the morning scrape and the agent's patch, then notify.
select cron.schedule('arzish-morning', '50 3 * * *', $$select public.invoke_function('jobs/morning')$$);
-- 09:40 PKT: load again in case the agent's patch arrived late.
select cron.schedule('arzish-late-load', '40 4 * * *', $$select public.invoke_function('jobs/load-market')$$);
-- 17:25 PKT on trading days: PSX closing prices, price alerts.
select cron.schedule('arzish-evening', '25 12 * * 1-5', $$select public.invoke_function('jobs/morning')$$);
-- Sunday 09:30 PKT: weekly digest.
select cron.schedule('arzish-digest', '30 4 * * 0', $$select public.invoke_function('jobs/digest')$$);
-- 03:15 PKT: housekeeping.
select cron.schedule('arzish-cleanup', '15 22 * * *', $$
  delete from public.auth_codes where expires_at < now() - interval '1 day';
  delete from public.notifications where created_at < now() - interval '180 days';
  delete from public.job_runs where ran_at < now() - interval '90 days';
  delete from public.checkout_sessions where completed_at is null and created_at < now() - interval '30 days';
  delete from public.billing_events where received_at < now() - interval '365 days';
$$);
