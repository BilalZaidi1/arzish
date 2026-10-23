// Daily notifications after the data load: values every user's portfolios (stored as snapshots for
// performance tracking), raises in-app notifications, emails the ones each user wants, and keeps
// trials and plans tidy.
import { addNotification, admin, logJob, planFor, todayPKT } from '../_shared/shared.ts';
import { appUrl, esc, layout, list, sendEmail, unsubscribeUrl } from '../_shared/email.ts';
import { type Prefs, wants } from '../_shared/kinds.ts';
// @ts-ignore: bundled engine, plain JS
import * as E from '../_engine/engine.js';

type Json = Record<string, any>;

const DAY = 864e5;
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
const addYears = (iso: string, y: number): string => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + y);
  return d.toISOString().slice(0, 10);
};
const rs = (v: number): string => E.fmtMoney(v, { currency: 'PKR', style: 'lakh', compact: true });

interface Ctx {
  today: string;
  latest: Json | null;
  psx: Json | null;
  funds: Json | null;
  events: Json[];
}

/** When a holding matures: its own date, else purchase date plus the National Savings term. */
function maturityOf(h: Json): string | null {
  if (typeof h.maturity === 'string' && /^\d{4}-\d{2}-\d{2}/.test(h.maturity)) return h.maturity.slice(0, 10);
  if (h.type === 'nss' && typeof h.purchaseDate === 'string') {
    const p = (E.NSS_PRODUCTS as Json[]).find((x) => x.key === h.sub);
    if (p && p.years > 0) return addYears(h.purchaseDate.slice(0, 10), p.years);
  }
  return null;
}

function ownPortfolios(ws: Json): Json[] {
  return (ws.portfolios ?? []).filter((p: Json) => !p.isExample);
}

/** Portfolios priced with the latest market data, PSX closes and fund NAVs (not saved back). */
function priced(ws: Json, ctx: Ctx): { m: Json; portfolios: Json[] } {
  let m = ws.market;
  const feed = ctx.latest ? E.parseFeed(ctx.latest) : null;
  if (feed) m = E.applyFeed(m, feed);
  let portfolios = ownPortfolios(ws);
  const psx = ctx.psx ? E.parsePsx(ctx.psx) : null;
  if (psx) portfolios = E.applyPsxPrices(portfolios, psx).portfolios;
  const funds = ctx.funds ? E.parseFunds(ctx.funds) : null;
  if (funds) portfolios = E.applyFundNavs(portfolios, funds).portfolios;
  return { m, portfolios };
}

async function candidates(user: Json, ws: Json, prefs: Prefs, plan: Json, ctx: Ctx, rules: Json[]): Promise<Json[]> {
  const out: Json[] = [];
  const pro = !!plan?.limits?.pro_screens;
  // Custom alerts: the oldest active rules, up to the plan's allowance.
  const maxRules = Number(plan?.limits?.alerts ?? 0);
  const myRules = rules.filter((r) => r.active).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).slice(0, Math.max(0, maxRules));
  const { m, portfolios } = priced(ws, ctx);
  const holdings: Json[] = portfolios.flatMap((p) => p.holdings ?? []);

  // Snapshots for performance tracking.
  for (const p of portfolios) {
    const t = E.computeTotals(p.holdings ?? [], p.liabilities ?? [], m);
    await admin.from('portfolio_snapshots').upsert({
      user_id: user.id, portfolio_id: p.id, d: ctx.today, value_pkr: Math.round(t.assets), cost_pkr: Math.round(t.cost),
      data: { name: p.name, netWorth: Math.round(t.netWorth), byClass: Object.fromEntries(Object.entries(t.byClass).map(([k, v]) => [k, Math.round(v as number)])), count: t.count },
    }, { onConflict: 'user_id,portfolio_id,d' });
  }

  // Maturities in 30 days and in the last week.
  for (const h of holdings) {
    const mat = maturityOf(h);
    if (!mat) continue;
    const days = daysBetween(ctx.today, mat);
    const v = rs(E.valuePKR(h, m));
    if (days >= 25 && days <= 30) out.push({ kind: 'maturity', title: `${h.name} matures in ${days} days`, body: `${v} matures on ${E.fmtDate(mat)}. Plan where the money goes next.`, link: '#holdings', dedupe: `mat30-${h.id}-${mat}` });
    if (days >= 0 && days <= 7) out.push({ kind: 'maturity', title: days === 0 ? `${h.name} matures today` : `${h.name} matures in ${days} day${days === 1 ? '' : 's'}`, body: `${v} matures on ${E.fmtDate(mat)}.`, link: '#holdings', dedupe: `mat7-${h.id}-${mat}` });
  }

  // Market events since the last run.
  for (const ev of ctx.events) {
    if (ev.kind === 'policy_rate') {
      out.push({ kind: 'policy_rate', title: `SBP ${ev.data.to > ev.data.from ? 'raised' : 'cut'} the policy rate to ${ev.data.to}%`, body: `From ${ev.data.from}%. Forecasts for T-bills, money market funds and deposits now start from the new rate.`, link: '#markets', dedupe: `policy-${ev.id}` });
    }
    if (ev.kind === 'nss_rate') {
      const held = new Set(holdings.filter((h) => h.type === 'nss').map((h) => h.sub));
      const mine = Object.entries(ev.data.changes ?? {}).filter(([k]) => held.has(k));
      if (mine.length) {
        const names = mine.map(([k, c]: [string, any]) => `${((E.NSS_PRODUCTS as Json[]).find((x) => x.key === k)?.label) ?? k} ${c.from}% to ${c.to}%`);
        out.push({ kind: 'nss_rate', title: 'National Savings changed rates on schemes you hold', body: `${names.join('; ')}${ev.data.effective ? `, from ${E.fmtDate(ev.data.effective)}` : ''}. New certificates earn the new rate.`, link: '#markets', dedupe: `nss-${ev.id}` });
      }
    }
  }

  // PSX: ex-dividend and price alerts on closing prices.
  const psx = ctx.psx;
  if (psx && Array.isArray(psx.stocks) && !psx.intraday) {
    const quotes = new Map<string, Json>(psx.stocks.map((q: Json) => [q.s, q]));
    const tickers = [...new Set(holdings.filter((h) => (h.type === 'psx_stock' || h.type === 'psx_etf') && h.ticker).map((h) => String(h.ticker).toUpperCase()))];
    for (const t of tickers) {
      const q = quotes.get(t);
      if (q?.x && String(q.x).includes('XD')) out.push({ kind: 'ex_dividend', title: `${t} is trading ex-dividend`, body: `PSX lists it as ${t}${q.x}. The price drop reflects the dividend, which goes to holders on the book-closure date.`, link: '#holdings', dedupe: `xd-${t}-${String(psx.asOf).slice(0, 7)}` });
    }
    for (const r of myRules) {
      if (r.kind === 'price_move') {
        const limit = Number(r.params?.pct ?? 0);
        const list = r.params?.ticker ? [String(r.params.ticker).toUpperCase()] : tickers;
        for (const t of list) {
          const q = quotes.get(t);
          if (!q || typeof q.c !== 'number' || !(limit > 0) || Math.abs(q.c) < limit) continue;
          out.push({ kind: 'price_alert', title: `${t} ${q.c > 0 ? 'rose' : 'fell'} ${Math.abs(q.c).toFixed(2)}% to Rs ${q.p}`, body: `Close on ${E.fmtDate(q.d ?? psx.asOf)}. Your alert is set at ${limit}% in a day.`, link: '#holdings', dedupe: `move-${r.id}-${t}-${psx.asOf}`, ruleId: r.id });
        }
      }
      if (r.kind === 'price_target') {
        const t = String(r.params?.ticker ?? '').toUpperCase();
        const q = quotes.get(t);
        if (!q) continue;
        const above = Number(r.params?.above), below = Number(r.params?.below);
        const hit = (above > 0 && q.p >= above) ? `reached Rs ${q.p}, at or above your target of Rs ${above}` : (below > 0 && q.p <= below) ? `fell to Rs ${q.p}, at or below your target of Rs ${below}` : '';
        if (hit) out.push({ kind: 'price_alert', title: `${t} ${hit.split(',')[0]}`, body: `${t} ${hit}. This one-off alert is now off.`, link: '#holdings', dedupe: `target-${r.id}`, ruleId: r.id, oneOff: true });
      }
    }
  }

  // Drawdown alerts from the stored snapshots.
  for (const r of myRules.filter((x) => x.kind === 'drawdown')) {
    const limit = Number(r.params?.pct ?? 0);
    if (!(limit > 0)) continue;
    for (const p of portfolios.filter((x) => !r.params?.portfolioId || x.id === r.params.portfolioId)) {
      const { data: snaps } = await admin.from('portfolio_snapshots').select('d, value_pkr').eq('user_id', user.id).eq('portfolio_id', p.id).gte('d', new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10)).order('d');
      if (!snaps || snaps.length < 2) continue;
      const peak = Math.max(...snaps.map((s: Json) => Number(s.value_pkr)));
      const now = Number(snaps.at(-1)!.value_pkr);
      const dd = peak > 0 ? (1 - now / peak) * 100 : 0;
      if (dd >= limit) out.push({ kind: 'drawdown', title: `${p.name} is ${dd.toFixed(1)}% below its peak`, body: `Value ${rs(now)} against a peak of ${rs(peak)} in the last year. Your alert is set at ${limit}%.`, link: '#risk', dedupe: `dd-${r.id}-${p.id}-${ctx.today.slice(0, 7)}`, ruleId: r.id });
    }
  }

  // Zakat and tax reminders.
  if (pro) {
    const y = Number(ctx.today.slice(0, 4));
    const zd = typeof user.prefs_row?.zakat_date === 'string' ? user.prefs_row.zakat_date : null;
    if (zd) {
      let next = `${y}-${zd}`;
      if (next < ctx.today) next = `${y + 1}-${zd}`;
      const days = daysBetween(ctx.today, next);
      if (days >= 0 && days <= 7) out.push({ kind: 'zakat', title: `Your zakat date is ${days === 0 ? 'today' : `in ${days} days`}`, body: 'The Tax and zakat screen works out zakat on your current holdings with your chosen nisab.', link: '#tax', dedupe: `zakat-${next}` });
    }
    const md = ctx.today.slice(5);
    if (md >= '06-10' && md <= '06-30') out.push({ kind: 'tax', title: 'VPS contributions before 30 June count for this tax year', body: 'Contributions to a voluntary pension scheme can earn a tax credit for the year ending 30 June.', link: '#tax', dedupe: `tax-vps-${y}` });
    if (md >= '09-10' && md <= '09-30') out.push({ kind: 'tax', title: 'Tax returns are due by 30 September', body: 'Filing keeps you on the Active Taxpayers List and its lower withholding rates.', link: '#tax', dedupe: `tax-return-${y}` });
  }

  // Funds that stopped reporting.
  if (ctx.funds && Array.isArray(ctx.funds.funds)) {
    const report = String(ctx.funds.reportDate ?? ctx.funds.asOf ?? '');
    const byId = new Map<string, Json>(ctx.funds.funds.map((f: Json) => [f.id, f]));
    for (const h of holdings.filter((x) => x.feedId)) {
      const f = byId.get(h.feedId);
      if (!f || !report) continue;
      if (daysBetween(f.d, report) >= 7 || f.stale) out.push({ kind: 'fund_stale', title: `${h.name} has not reported a NAV since ${E.fmtDate(f.d)}`, body: 'Its value uses that NAV until a new one is published.', link: '#holdings', dedupe: `stale-${h.feedId}-${f.d}` });
    }
  }

  return out.filter((n) => wants(prefs, n.kind, 'inapp') || wants(prefs, n.kind, 'email'));
}

async function billingHousekeeping(): Promise<Json> {
  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 3 * DAY).toISOString();
  const out: Json = { endingSoon: 0, expired: 0, emails: 0 };
  const raised = new Map<string, Json[]>();
  const keep = (userId: string, row: { id: number } | null, n: Json) => {
    if (!row) return;
    raised.set(userId, [...(raised.get(userId) ?? []), { ...n, id: row.id }]);
  };
  // Trials ending within three days.
  const { data: ending } = await admin.from('subscriptions').select('id, user_id, current_period_end').eq('status', 'trialing').gt('current_period_end', now).lte('current_period_end', soon);
  for (const s of ending ?? []) {
    const n = { kind: 'billing', title: `Your Pro trial ends on ${E.fmtDate(String(s.current_period_end).slice(0, 10))}`, body: 'Upgrade to keep Pro features, email alerts and more AI questions. Your data stays either way.', link: '#billing', dedupe: `trial-end-${s.id}` };
    const row = await addNotification(s.user_id, n);
    if (row) out.endingSoon++;
    keep(s.user_id, row, n);
  }
  // Lapsed trials and grants; card plans past their three-day grace period.
  const { data: lapsed } = await admin.from('subscriptions').select('id, user_id, source, status, current_period_end').in('status', ['trialing', 'active', 'past_due']).lt('current_period_end', now);
  for (const s of lapsed ?? []) {
    const graceOver = s.source !== 'safepay' || Date.parse(s.current_period_end) < Date.now() - 3 * DAY;
    if (!graceOver) continue;
    await admin.from('subscriptions').update({ status: 'expired', updated_at: now }).eq('id', s.id);
    out.expired++;
    // Say so only when nothing else keeps the user on a paid plan.
    const plan = await planFor(s.user_id);
    if (plan.plan !== 'free') continue;
    const n = { kind: 'billing', title: s.source === 'trial' ? 'Your Pro trial has ended' : 'Your Pro plan has ended', body: 'You are on the Free plan now. Everything you entered is kept.', link: '#billing', dedupe: `ended-${s.id}` };
    keep(s.user_id, await addNotification(s.user_id, n), n);
  }
  // Billing notices always go by email too.
  if (raised.size) {
    const { data: profs } = await admin.from('profiles').select('id, email, disabled').in('id', [...raised.keys()]);
    for (const p of profs ?? []) {
      const items = raised.get(p.id) ?? [];
      if (p.disabled || !items.length) continue;
      if (await emailNew({ ...p, prefs_row: null }, items)) {
        out.emails++;
        await admin.from('notifications').update({ emailed_at: new Date().toISOString() }).in('id', items.map((i) => i.id));
      }
    }
  }
  return out;
}

async function emailNew(user: Json, items: Json[]): Promise<boolean> {
  if (!user.email || !items.length) return false;
  const settings = await appUrl('/app#notifications');
  const open = await appUrl('/app');
  const unsub = user.prefs_row?.unsubscribe_token ? await unsubscribeUrl(user.prefs_row.unsubscribe_token, 'alerts') : undefined;
  const subject = items.length === 1 ? items[0].title : `${items.length} updates from Arzish`;
  const html = layout({
    title: items.length === 1 ? items[0].title : `${items.length} updates on your portfolio`,
    preheader: items.map((i) => i.title).join(' · ').slice(0, 140),
    body: list(items.map((i) => `<strong>${esc(i.title)}</strong>${i.body ? `<br><span style="color:#475069">${esc(i.body)}</span>` : ''}`)),
    cta: open.startsWith('http') ? { label: 'Open Arzish', url: open } : undefined,
    settingsUrl: settings.startsWith('http') ? settings : undefined,
    unsubscribeUrl: unsub,
  });
  const text = items.map((i) => `${i.title}\n${i.body ?? ''}`).join('\n\n') + `${open.startsWith('http') ? `\n\nOpen Arzish: ${open}` : ''}\n${unsub ? `Unsubscribe from alert emails: ${unsub}` : ''}`;
  const r = await sendEmail({ to: user.email, subject, html, text, kind: 'alerts', userId: user.id, unsubscribeUrl: unsub, idempotencyKey: `alerts-${user.id}-${items.map((i) => i.id).join('-')}` });
  return r.ok;
}

export async function runNotify(): Promise<Json> {
  const today = todayPKT();
  const info: Json = { today, users: 0, notifications: 0, emails: 0, errors: [] as string[] };
  try {
    const [{ data: latest }, { data: psx }, { data: funds }] = await Promise.all([
      admin.from('market_docs').select('doc').eq('id', 'latest').maybeSingle(),
      admin.from('market_docs').select('doc').eq('id', 'psx').maybeSingle(),
      admin.from('market_docs').select('doc').eq('id', 'funds').maybeSingle(),
    ]);
    const { data: last } = await admin.from('job_runs').select('ran_at').eq('job', 'notify').eq('ok', true).order('ran_at', { ascending: false }).limit(1);
    const since = last?.[0]?.ran_at ?? new Date(Date.now() - 2 * DAY).toISOString();
    const { data: events } = await admin.from('market_events').select('*').gt('created_at', since).order('created_at');
    const ctx: Ctx = { today, latest: latest?.doc ?? null, psx: psx?.doc ?? null, funds: funds?.doc ?? null, events: events ?? [] };

    info.billing = await billingHousekeeping();

    const { data: profiles } = await admin.from('profiles').select('id, email, disabled').eq('disabled', false);
    const { data: prefsRows } = await admin.from('notification_prefs').select('user_id, prefs, digest, zakat_date, unsubscribe_token');
    const prefsBy = new Map<string, Json>((prefsRows ?? []).map((p: Json) => [p.user_id, p]));
    const { data: rules } = await admin.from('alert_rules').select('*').eq('active', true);
    const rulesBy = new Map<string, Json[]>();
    for (const r of rules ?? []) rulesBy.set(r.user_id, [...(rulesBy.get(r.user_id) ?? []), r]);

    for (const p of profiles ?? []) {
      try {
        const { data: wsRow } = await admin.from('workspaces').select('ws').eq('user_id', p.id).maybeSingle();
        if (!wsRow?.ws) continue;
        const ws = E.migrateWorkspace(wsRow.ws);
        if (!ws) continue;
        info.users++;
        const prefsRow = prefsBy.get(p.id) ?? null;
        const user = { ...p, prefs_row: prefsRow };
        const prefs: Prefs = (prefsRow?.prefs ?? {}) as Prefs;
        const plan = await planFor(p.id);
        const cands = await candidates(user, ws, prefs, plan, ctx, rulesBy.get(p.id) ?? []);
        const fresh: Json[] = [];
        for (const c of cands) {
          if (!wants(prefs, c.kind, 'inapp') && !wants(prefs, c.kind, 'email')) continue;
          const row = await addNotification(p.id, { kind: c.kind, title: c.title, body: c.body, link: c.link, dedupe: c.dedupe, data: c.ruleId ? { rule: c.ruleId } : undefined });
          if (!row) continue;
          info.notifications++;
          fresh.push({ ...c, id: row.id });
          if (c.ruleId) await admin.from('alert_rules').update({ last_fired_at: new Date().toISOString(), ...(c.oneOff ? { active: false } : {}) }).eq('id', c.ruleId);
          // A notification wanted only by email should not linger in the inbox.
          if (!wants(prefs, c.kind, 'inapp')) await admin.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', row.id);
        }
        // Alert emails are a paid feature; free plans get them in the app.
        const emailable = plan?.limits?.email_alerts ? fresh.filter((c) => wants(prefs, c.kind, 'email')) : [];
        if (emailable.length && (await emailNew(user, emailable))) {
          info.emails++;
          await admin.from('notifications').update({ emailed_at: new Date().toISOString() }).in('id', emailable.map((c) => c.id));
        }
      } catch (e) {
        info.errors.push(`${p.id.slice(0, 8)}: ${(e as Error).message}`.slice(0, 200));
      }
    }
    await logJob('notify', info.errors.length === 0, info);
    return { ok: true, ...info };
  } catch (e) {
    info.errors.push((e as Error).message);
    await logJob('notify', false, info);
    return { ok: false, ...info };
  }
}
