// The account dialog: plan and billing, notification settings, alerts, profile and data, invites,
// and help. Everything reads and writes the person's own rows (row-level security does the rest).
import React, { useCallback, useEffect, useState } from 'react';
import { api, errorText, sb } from './supabase';
import { daysLeft, fmtPkr, useAccount, type AccountTab } from './session';
import { NOTIFICATION_KINDS, type Prefs } from './kinds';
import { fmtDate } from '../engine/format';
import { Icon } from '../ui/components/Icon';
import { Badge, Button, Callout, copyText, Field, KV, Meter, Modal, Pill, Select, Spinner, Tabs, Toggle } from '../ui/components/primitives';

type Msg = { tone: 'good' | 'warn' | 'info'; text: string } | null;

function Note({ msg }: { msg: Msg }) {
  return msg ? <Callout tone={msg.tone}>{msg.text}</Callout> : null;
}

const STATUS_LABEL: Record<string, string> = { free: 'Free', trialing: 'Trial', active: 'Active', past_due: 'Payment due', canceled: 'Cancelled', expired: 'Ended' };
const SOURCE_LABEL: Record<string, string> = { trial: 'Sign-up trial', safepay: 'Card subscription', admin: 'Set by Arzish', coupon: 'Gift code', referral: 'Referral reward' };

// ------------------------------------------------------------------ plan and billing
interface PaymentRow {
  created_at: string;
  plan_id: string | null;
  interval: string | null;
  amount: number | null;
  currency: string | null;
  provider: string;
  status: string;
}

function PlanTab() {
  const a = useAccount();
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const p = a.plan;
  const L = p.limits;
  const aiLimit = Number(L.ai_month ?? 0);
  const left = daysLeft(p.periodEnd);

  useEffect(() => {
    sb.from('payments').select('created_at, plan_id, interval, amount, currency, provider, status').order('created_at', { ascending: false }).limit(24).then(({ data }) => setPayments((data ?? []) as PaymentRow[]));
  }, []);

  const cancel = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api('billing/cancel');
      await a.refresh();
      setMsg({ tone: 'good', text: 'Your plan will not renew. You keep Pro until the end of the period you paid for.' });
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
    }
    setBusy(false);
  };

  const lim = (k: string) => {
    const v = L[k];
    return typeof v === 'number' ? (v >= 100_000 ? 'No practical limit' : v.toLocaleString('en-US')) : '–';
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="w-plan-now">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <span className="w-plan-name">{p.status === 'trialing' ? `${p.name} trial` : p.name}</span>
            <Pill tone={p.status === 'past_due' ? 'warn' : p.status === 'active' || p.status === 'trialing' ? 'good' : 'neutral'}>{STATUS_LABEL[p.status] ?? p.status}</Pill>
          </div>
          <div className="small ink2" style={{ marginTop: 4 }}>
            {p.status === 'trialing' && p.periodEnd && `Trial ends on ${fmtDate(p.periodEnd.slice(0, 10))} (${left} day${left === 1 ? '' : 's'} left). You move to Free afterwards unless you upgrade; your data stays.`}
            {p.status === 'active' && p.periodEnd && (p.cancelAtPeriodEnd || p.source !== 'safepay' ? `Pro until ${fmtDate(p.periodEnd.slice(0, 10))}.` : `Renews on ${fmtDate(p.periodEnd.slice(0, 10))}.`)}
            {p.status === 'past_due' && 'Your last payment did not go through. Pro stays on for a few days.'}
            {p.status === 'free' && 'The Free plan. Upgrade any time for stress tests, the optimizer, tax and zakat, email alerts and more AI questions.'}
            {p.source && p.status !== 'free' && <span className="muted"> · {SOURCE_LABEL[p.source] ?? p.source}</span>}
          </div>
        </div>
        {(p.plan === 'free' || p.status === 'trialing') && <Button variant="primary" icon="bolt" onClick={() => a.openUpgrade('general')}>Upgrade</Button>}
      </div>

      <div className="grid" style={{ gap: 12 }}>
        <div className="card span-6" style={{ padding: 14 }}>
          <div className="small strong" style={{ marginBottom: 8 }}>AI questions this month</div>
          <Meter value={aiLimit > 0 ? Math.min(1, a.aiUsed / aiLimit) : 0} color="var(--accent)" label={`${a.aiUsed} of ${aiLimit} used`} />
          <div className="tiny muted" style={{ marginTop: 6 }}>{a.aiUsed} of {aiLimit} used. Resets on the 1st.</div>
        </div>
        <div className="card span-6" style={{ padding: 14 }}>
          <KV rows={[['Portfolios', lim('portfolios')], ['Holdings', lim('holdings')], ['Goals', lim('goals')], ['Email alerts', L.email_alerts ? 'Included' : 'Pro']]} />
        </div>
      </div>

      <Note msg={msg} />
      {p.source === 'safepay' && (p.status === 'active' || p.status === 'past_due') && !p.cancelAtPeriodEnd && (
        <div className="row"><Button variant="danger" disabled={busy} onClick={cancel}>Cancel renewal</Button><span className="small muted">You keep Pro until {p.periodEnd ? fmtDate(p.periodEnd.slice(0, 10)) : 'the end of the period'}.</span></div>
      )}

      <div>
        <div className="small strong" style={{ marginBottom: 6 }}>Payments</div>
        {payments === null ? <div className="row small muted"><Spinner /> Loading…</div> : payments.length === 0 ? (
          <div className="small muted">No payments yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="t compact">
              <thead><tr><th>Date</th><th>Plan</th><th className="num">Amount</th><th>Method</th><th>Status</th></tr></thead>
              <tbody>
                {payments.map((x, i) => (
                  <tr key={i}>
                    <td>{fmtDate(x.created_at.slice(0, 10))}</td>
                    <td>{x.plan_id === 'pro' ? 'Pro' : x.plan_id ?? '–'}{x.interval ? `, ${x.interval}ly` : ''}</td>
                    <td className="num">{x.amount ? (x.currency === 'PKR' || !x.currency ? fmtPkr(x.amount) : `${x.currency} ${x.amount}`) : '–'}</td>
                    <td>{x.provider === 'safepay' ? 'Card' : 'Bank or wallet'}</td>
                    <td>{x.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ notifications
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function NotificationsTab() {
  const a = useAccount();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [digest, setDigest] = useState<'weekly' | 'off'>('weekly');
  const [zakat, setZakat] = useState<string>('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const emailOk = !!a.plan.limits.email_alerts;
  const pro = !!a.plan.limits.pro_screens;

  useEffect(() => {
    sb.from('notification_prefs').select('prefs, digest, zakat_date').maybeSingle().then(({ data }) => {
      setPrefs((data?.prefs ?? {}) as Prefs);
      setDigest(data?.digest === 'off' ? 'off' : 'weekly');
      setZakat(data?.zakat_date ?? '');
    });
  }, []);

  const value = (kind: string, ch: 'inapp' | 'email'): boolean => {
    const v = prefs?.[kind]?.[ch];
    return typeof v === 'boolean' ? v : NOTIFICATION_KINDS[kind][ch];
  };
  const set = (kind: string, ch: 'inapp' | 'email', v: boolean) => setPrefs((p) => ({ ...(p ?? {}), [kind]: { ...(p?.[kind] ?? {}), [ch]: v } }));

  const save = async () => {
    if (!a.userId) return;
    setBusy(true);
    setMsg(null);
    const { error } = await sb.from('notification_prefs').update({ prefs: prefs ?? {}, digest, zakat_date: zakat || null, updated_at: new Date().toISOString() }).eq('user_id', a.userId);
    setBusy(false);
    setMsg(error ? { tone: 'warn', text: 'Could not save. Try again.' } : { tone: 'good', text: 'Saved.' });
  };

  if (!prefs) return <div className="row small muted"><Spinner /> Loading…</div>;
  const [zm, zd] = zakat ? zakat.split('-') : ['', ''];
  return (
    <div className="stack" style={{ gap: 14 }}>
      {!emailOk && <Callout>On the Free plan alerts appear here in the app and in the weekly digest. Pro also sends them by email. <button type="button" className="linkbtn" onClick={() => a.openUpgrade('email_alerts')}>See Pro</button></Callout>}
      <div className="table-wrap">
        <table className="t compact">
          <thead><tr><th>Notification</th><th>In the app</th><th>By email</th></tr></thead>
          <tbody>
            {Object.entries(NOTIFICATION_KINDS).map(([k, m]) => {
              const locked = !!m.locked;
              const needsPro = !!m.pro && !pro;
              return (
                <tr key={k}>
                  <td>
                    <div className="strong small">{m.label} {m.pro && <Badge tone="accent">Pro</Badge>}</div>
                    <div className="tiny muted">{m.desc}</div>
                  </td>
                  <td>{locked ? <span className="tiny muted">Always</span> : <input type="checkbox" aria-label={`${m.label} in the app`} disabled={needsPro} checked={!needsPro && value(k, 'inapp')} onChange={(e) => set(k, 'inapp', e.target.checked)} />}</td>
                  <td>{locked ? <span className="tiny muted">Always</span> : <input type="checkbox" aria-label={`${m.label} by email`} disabled={needsPro || !emailOk} checked={!needsPro && emailOk && value(k, 'email')} onChange={(e) => set(k, 'email', e.target.checked)} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid" style={{ gap: 12 }}>
        <div className="span-6">
          <Field label="Weekly digest email" hint="Sunday morning: your week’s change, biggest moves and coming maturities.">
            <Select value={digest} onChange={setDigest} options={[{ value: 'weekly', label: 'Every Sunday' }, { value: 'off', label: 'Off' }]} ariaLabel="Weekly digest" />
          </Field>
        </div>
        <div className="span-6">
          <Field label={<>Zakat date {!pro && <Badge tone="accent">Pro</Badge>}</>} hint="A reminder a week before, with zakat worked out on your holdings.">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <select className="select" aria-label="Zakat month" disabled={!pro} value={zm} onChange={(e) => setZakat(e.target.value ? `${e.target.value}-${zd || '01'}` : '')}>
                <option value="">Not set</option>
                {MONTHS.map((n, i) => <option key={n} value={String(i + 1).padStart(2, '0')}>{n}</option>)}
              </select>
              <select className="select" aria-label="Zakat day" disabled={!pro || !zm} value={zd} onChange={(e) => setZakat(`${zm}-${e.target.value}`)} style={{ width: 90 }}>
                {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => <option key={d} value={d}>{Number(d)}</option>)}
              </select>
            </div>
          </Field>
        </div>
      </div>
      <Note msg={msg} />
      <div className="row"><Button variant="primary" disabled={busy} onClick={save}>Save settings</Button></div>
    </div>
  );
}

// ------------------------------------------------------------------ alerts
interface Rule {
  id: number;
  kind: 'price_move' | 'price_target' | 'drawdown';
  params: { ticker?: string; pct?: number; above?: number; below?: number };
  active: boolean;
  last_fired_at: string | null;
}

function ruleText(r: Rule): string {
  if (r.kind === 'price_move') return `${r.params.ticker ? r.params.ticker : 'Any PSX share I hold'} moves ${r.params.pct}% or more in a day`;
  if (r.kind === 'price_target') return `${r.params.ticker} ${r.params.above ? `reaches Rs ${r.params.above} or more` : `falls to Rs ${r.params.below} or less`} (one-off)`;
  return `A portfolio falls ${r.params.pct}% or more from its peak`;
}

function AlertsTab() {
  const a = useAccount();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [kind, setKind] = useState<Rule['kind']>('price_move');
  const [ticker, setTicker] = useState('');
  const [pct, setPct] = useState('5');
  const [dir, setDir] = useState<'above' | 'below'>('above');
  const [price, setPrice] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const max = Number(a.plan.limits.alerts ?? 0);
  const emails = !!a.plan.limits.email_alerts;

  const load = useCallback(() => {
    sb.from('alert_rules').select('id, kind, params, active, last_fired_at').order('created_at').then(({ data }) => setRules((data ?? []) as Rule[]));
  }, []);
  useEffect(load, [load]);

  if (!(max > 0)) {
    return (
      <div className="w-paywall" style={{ padding: '18px 8px' }}>
        <div className="w-paywall-icon"><Icon name="bolt" size={22} /></div>
        <h2>Price and drawdown alerts come with Pro</h2>
        <ul>
          <li><Icon name="check" size={14} /> When a share you hold moves sharply in a day</li>
          <li><Icon name="check" size={14} /> When a share reaches your target price</li>
          <li><Icon name="check" size={14} /> When a portfolio falls a set share from its peak</li>
        </ul>
        <Button variant="primary" icon="bolt" onClick={() => a.openUpgrade('alerts')}>See Pro</Button>
      </div>
    );
  }

  const add = async () => {
    setMsg(null);
    if (!a.userId) return;
    if ((rules?.length ?? 0) >= max) return setMsg({ tone: 'warn', text: `Your plan allows ${max} alerts. Remove one first.` });
    const t = ticker.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
    const params: Rule['params'] = {};
    if (kind === 'price_move') {
      const v = Number(pct);
      if (!(v > 0 && v <= 50)) return setMsg({ tone: 'warn', text: 'Enter a move between 0.5% and 50%.' });
      params.pct = v;
      if (t) params.ticker = t;
    } else if (kind === 'price_target') {
      const v = Number(price);
      if (!t) return setMsg({ tone: 'warn', text: 'Enter the PSX ticker, for example OGDC.' });
      if (!(v > 0)) return setMsg({ tone: 'warn', text: 'Enter a target price in rupees.' });
      params.ticker = t;
      params[dir] = v;
    } else {
      const v = Number(pct);
      if (!(v >= 1 && v <= 90)) return setMsg({ tone: 'warn', text: 'Enter a fall between 1% and 90%.' });
      params.pct = v;
    }
    const { error } = await sb.from('alert_rules').insert({ user_id: a.userId, kind, params, active: true });
    if (error) return setMsg({ tone: 'warn', text: 'Could not add the alert. Try again.' });
    setTicker('');
    setPrice('');
    setMsg({ tone: 'good', text: 'Alert added. Alerts are checked on closing prices every trading evening.' });
    load();
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <p className="small ink2" style={{ margin: 0 }}>Alerts are checked on PSX closing prices each trading evening and on your portfolio’s value. {emails ? 'They arrive in the app, and by email if you switch that on under Notifications.' : 'They arrive in the app.'}</p>
      {!emails && (
        <div className="w-teaser"><Icon name="bolt" size={14} /><span>Your plan includes {max} alerts. Pro allows 50 and sends them by email too.</span><button type="button" className="linkbtn" onClick={() => a.openUpgrade('alerts')}>See Pro</button></div>
      )}
      {rules === null ? <div className="row small muted"><Spinner /> Loading…</div> : rules.length === 0 ? <div className="small muted">No alerts yet.</div> : (
        <ul className="list-plain">
          {rules.map((r) => (
            <li key={r.id} className="w-rule">
              <Toggle checked={r.active} onChange={async (v) => { await sb.from('alert_rules').update({ active: v }).eq('id', r.id); load(); }} label={<span className="small">{ruleText(r)}</span>} />
              <span className="tiny muted">{r.last_fired_at ? `Last ${fmtDate(r.last_fired_at.slice(0, 10))}` : ''}</span>
              <Button size="sm" variant="ghost" iconOnly icon="trash" onClick={async () => { await sb.from('alert_rules').delete().eq('id', r.id); load(); }}>Remove alert</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="card tint" style={{ padding: 12 }}>
        <div className="stack" style={{ gap: 10 }}>
          <div className="small strong">New alert</div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Type">
              <Select value={kind} onChange={setKind} options={[{ value: 'price_move', label: 'Big daily move' }, { value: 'price_target', label: 'Target price' }, { value: 'drawdown', label: 'Portfolio drawdown' }]} ariaLabel="Alert type" />
            </Field>
            {kind !== 'drawdown' && (
              <Field label={kind === 'price_move' ? 'Ticker (blank for all I hold)' : 'Ticker'}>
                <input className="input" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="OGDC" style={{ width: 130 }} />
              </Field>
            )}
            {kind === 'price_target' ? (
              <>
                <Field label="When it is">
                  <Select value={dir} onChange={setDir} options={[{ value: 'above', label: 'At or above' }, { value: 'below', label: 'At or below' }]} ariaLabel="Direction" />
                </Field>
                <Field label="Price (Rs)">
                  <input className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 110 }} />
                </Field>
              </>
            ) : (
              <Field label={kind === 'price_move' ? 'Move of at least (%)' : 'Fall from peak of (%)'}>
                <input className="input num" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} style={{ width: 90 }} />
              </Field>
            )}
            <Button variant="primary" icon="plus" onClick={add}>Add</Button>
          </div>
          <div className="tiny muted">{rules?.length ?? 0} of {max} alerts used.</div>
        </div>
      </div>
      <Note msg={msg} />
    </div>
  );
}

// ------------------------------------------------------------------ profile and data
function ProfileTab() {
  const a = useAccount();
  const [name, setName] = useState(a.profile?.full_name ?? '');
  const [optIn, setOptIn] = useState(!!a.profile?.marketing_opt_in);
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!a.userId) return;
    setBusy(true);
    const { error } = await sb.from('profiles').update({ full_name: name.trim() || null, marketing_opt_in: optIn }).eq('id', a.userId);
    setBusy(false);
    if (!error) await a.refresh();
    setMsg(error ? { tone: 'warn', text: 'Could not save. Try again.' } : { tone: 'good', text: 'Saved.' });
  };

  const exportAll = async () => {
    setBusy(true);
    const [profile, ws, prefs, rules, notes, subs, pays, fb] = await Promise.all([
      sb.from('profiles').select('*').maybeSingle(),
      sb.from('workspaces').select('ws, updated_at').maybeSingle(),
      sb.from('notification_prefs').select('prefs, digest, zakat_date').maybeSingle(),
      sb.from('alert_rules').select('*'),
      sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(500),
      sb.from('subscriptions').select('*'),
      sb.from('payments').select('created_at, plan_id, interval, amount, currency, provider, status'),
      sb.from('feedback').select('*'),
    ]);
    const out = { exportedAt: new Date().toISOString(), profile: profile.data, workspace: ws.data, notificationSettings: prefs.data, alerts: rules.data, notifications: notes.data, subscriptions: subs.data, payments: pays.data, messages: fb.data };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url;
    el.download = `arzish-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    el.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    setBusy(false);
  };

  const del = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api('account/delete', { confirm });
      await sb.auth.signOut().catch(() => undefined);
      window.location.assign('/?deleted=1');
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid" style={{ gap: 12 }}>
        <div className="span-6"><Field label="Name" htmlFor="w-name"><input id="w-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field></div>
        <div className="span-6"><Field label="Email"><input className="input" value={a.email ?? ''} readOnly /></Field></div>
      </div>
      <Toggle checked={optIn} onChange={setOptIn} label="Email me occasional news about Arzish features" />
      <div className="row"><Button variant="primary" disabled={busy} onClick={save}>Save</Button></div>
      <Note msg={msg} />
      <div className="divider" />
      <div className="stack" style={{ gap: 8 }}>
        <div className="small strong">Your data</div>
        <p className="small ink2" style={{ margin: 0 }}>Download everything Arzish keeps about you: your portfolios, settings, alerts, notifications, plan and payment history. You can also export holdings as CSV from Settings.</p>
        <div><Button icon="download" disabled={busy} onClick={exportAll}>Download my data</Button></div>
      </div>
      <div className="divider" />
      <div className="stack" style={{ gap: 8 }}>
        <div className="small strong" style={{ color: 'var(--critical-ink)' }}>Delete account</div>
        <p className="small ink2" style={{ margin: 0 }}>This removes your account, portfolios and history for good and stops any card subscription. It cannot be undone. Type your email address to confirm.</p>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={a.email ?? ''} aria-label="Type your email to confirm" style={{ maxWidth: 320 }} />
          <Button variant="danger" disabled={busy || confirm.trim().toLowerCase() !== (a.email ?? '').toLowerCase()} onClick={del}>Delete account</Button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ invite
function InviteTab() {
  const a = useAccount();
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/?ref=${a.profile?.referral_code ?? ''}`;
  const days = Number(a.settings.referral_reward_days ?? 30);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="w-invite">
        <Icon name="gift" size={22} />
        <div>
          <div className="strong">Give Arzish, get Pro</div>
          <div className="small ink2">Share your link. Friends get the usual free trial; when someone you invited subscribes to Pro, you get {days} days of Pro free.</div>
        </div>
      </div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input className="input mono" value={link} readOnly aria-label="Your invite link" onFocus={(e) => e.target.select()} />
        <Button icon={copied ? 'check' : 'copy'} onClick={async () => { setCopied(await copyText(link)); window.setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <div className="row">
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(`I track my investments with Arzish: PSX, mutual funds, savings certificates and gold in one place, with forecasts. Try it: ${link}`)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
        <a className="btn" href={`mailto:?subject=${encodeURIComponent('Try Arzish')}&body=${encodeURIComponent(`I track my investments with Arzish. Try it: ${link}`)}`}>Share by email</a>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ help and feedback
interface FeedbackRow {
  id: number;
  kind: string;
  message: string;
  status: string;
  reply: string | null;
  created_at: string;
}

function HelpTab() {
  const a = useAccount();
  const [kind, setKind] = useState<'question' | 'idea' | 'bug' | 'billing'>('question');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    sb.from('feedback').select('id, kind, message, status, reply, created_at').order('created_at', { ascending: false }).limit(20).then(({ data }) => setRows((data ?? []) as FeedbackRow[]));
  }, []);
  useEffect(load, [load]);
  const send = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api('feedback', { kind, message: text, page: 'account' });
      setText('');
      setMsg({ tone: 'good', text: 'Sent. We reply here and by email.' });
      load();
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
    }
    setBusy(false);
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label="About">
          <Select value={kind} onChange={setKind} options={[{ value: 'question', label: 'A question' }, { value: 'idea', label: 'An idea' }, { value: 'bug', label: 'Something is wrong' }, { value: 'billing', label: 'Billing' }]} ariaLabel="Message type" />
        </Field>
      </div>
      <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write to us…" aria-label="Your message" maxLength={4000} />
      <div className="row"><Button variant="primary" icon="send" disabled={busy || text.trim().length < 3} onClick={send}>Send</Button>{typeof a.settings.support_email === 'string' && a.settings.support_email.includes('@') && <span className="small muted">Or email {a.settings.support_email}</span>}</div>
      <Note msg={msg} />
      {rows && rows.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="small strong">Your messages</div>
          {rows.map((r) => (
            <div key={r.id} className="card tint" style={{ padding: 12 }}>
              <div className="row-between"><span className="tiny muted">{fmtDate(r.created_at.slice(0, 10))} · {r.kind}</span><Pill tone={r.status === 'answered' ? 'good' : 'neutral'}>{r.status === 'answered' ? 'Answered' : r.status === 'closed' ? 'Closed' : 'Open'}</Pill></div>
              <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{r.message}</div>
              {r.reply && <div className="w-reply small"><strong>Arzish:</strong> {r.reply}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ dialog
const TABS: { value: AccountTab; label: string }[] = [
  { value: 'plan', label: 'Plan and billing' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'alerts', label: 'Alerts' },
  { value: 'profile', label: 'Profile and data' },
  { value: 'invite', label: 'Invite' },
  { value: 'help', label: 'Help' },
];

export function AccountModal({ tab, onClose }: { tab: AccountTab; onClose: () => void }) {
  const [t, setT] = useState<AccountTab>(tab);
  useEffect(() => setT(tab), [tab]);
  return (
    <Modal wide title="Your account" onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <Tabs value={t} onChange={setT} options={TABS} label="Account sections" />
        {t === 'plan' && <PlanTab />}
        {t === 'notifications' && <NotificationsTab />}
        {t === 'alerts' && <AlertsTab />}
        {t === 'profile' && <ProfileTab />}
        {t === 'invite' && <InviteTab />}
        {t === 'help' && <HelpTab />}
      </div>
    </Modal>
  );
}
