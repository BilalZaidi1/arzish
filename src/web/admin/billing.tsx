// Back-office billing: subscriptions and payments, plan prices and limits, gift codes, and the raw
// Safepay webhook log.
import React, { useMemo, useState } from 'react';
import { sb, errorText } from '../supabase';
import { act, d, dt, JsonView, Loading, n, pkr, rows, useLoad, type Json } from './common';
import { Button, Callout, Card, Field, Modal, Pill, Tabs, Toggle } from '../../ui/components/primitives';

async function withEmails<T extends Json>(list: T[]): Promise<(T & { email?: string })[]> {
  const ids = [...new Set(list.map((r) => r.user_id).filter(Boolean))];
  if (!ids.length) return list;
  const { data } = await sb.from('profiles').select('id, email').in('id', ids);
  const by = new Map((data ?? []).map((p: Json) => [p.id, p.email]));
  return list.map((r) => ({ ...r, email: by.get(r.user_id) }));
}

type Tab = 'subs' | 'payments' | 'plans' | 'coupons' | 'events';

export function Billing() {
  const [tab, setTab] = useState<Tab>('subs');
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Tabs value={tab} onChange={setTab} options={[{ value: 'subs', label: 'Subscriptions' }, { value: 'payments', label: 'Payments' }, { value: 'plans', label: 'Plans and prices' }, { value: 'coupons', label: 'Gift codes' }, { value: 'events', label: 'Payment events' }]} label="Billing sections" />
      {tab === 'subs' && <Subscriptions />}
      {tab === 'payments' && <Payments />}
      {tab === 'plans' && <Plans />}
      {tab === 'coupons' && <Coupons />}
      {tab === 'events' && <Events />}
    </div>
  );
}

function Subscriptions() {
  const [filter, setFilter] = useState<'live' | 'all'>('live');
  const s = useLoad(async () => {
    let q = sb.from('subscriptions').select('*').order('created_at', { ascending: false }).limit(300);
    if (filter === 'live') q = q.in('status', ['trialing', 'active', 'past_due']);
    return withEmails(await rows<Json[]>(q));
  }, [filter]);
  return (
    <Card flush title="Subscriptions" actions={<Toggle checked={filter === 'live'} onChange={(v) => setFilter(v ? 'live' : 'all')} label="Live only" />}>
      <Loading error={s.error} loading={s.loading && !s.data} />
      {s.data && (
        <div className="table-wrap"><table className="t compact"><thead><tr><th>Person</th><th>Plan</th><th>Status</th><th>Source</th><th>From</th><th>Until</th><th>Note</th></tr></thead><tbody>
          {s.data.map((r) => <tr key={r.id}><td>{r.email ?? r.user_id}</td><td>{r.plan_id}{r.interval ? `, ${r.interval}ly` : ''}</td><td>{r.status}{r.cancel_at_period_end ? ' (ends)' : ''}</td><td>{r.source}</td><td>{d(r.current_period_start)}</td><td>{d(r.current_period_end)}</td><td className="small">{r.note ?? ''}</td></tr>)}
        </tbody></table></div>
      )}
    </Card>
  );
}

function Payments() {
  const p = useLoad(async () => withEmails(await rows<Json[]>(sb.from('payments').select('id, user_id, plan_id, interval, amount, currency, provider, provider_ref, status, created_at').order('created_at', { ascending: false }).limit(300))));
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of p.data ?? []) if (r.status === 'paid') t[r.currency ?? 'PKR'] = (t[r.currency ?? 'PKR'] ?? 0) + Number(r.amount ?? 0);
    return t;
  }, [p.data]);
  return (
    <Card flush title="Payments" sub={Object.entries(totals).map(([c, v]) => `${c} ${n(Math.round(v))} received`).join(' · ') || 'None yet'}>
      <Loading error={p.error} loading={p.loading && !p.data} />
      {p.data && (
        <div className="table-wrap"><table className="t compact"><thead><tr><th>Date</th><th>Person</th><th>Plan</th><th className="num">Amount</th><th>Provider</th><th>Reference</th><th>Status</th></tr></thead><tbody>
          {p.data.map((r) => <tr key={r.id}><td>{dt(r.created_at)}</td><td>{r.email ?? r.user_id ?? '–'}</td><td>{r.plan_id}{r.interval ? `, ${r.interval}ly` : ''}</td><td className="num">{r.currency === 'PKR' || !r.currency ? pkr(r.amount) : `${r.currency} ${r.amount}`}</td><td>{r.provider}</td><td className="tiny mono">{r.provider_ref ?? ''}</td><td>{r.status}</td></tr>)}
        </tbody></table></div>
      )}
    </Card>
  );
}

const LIMIT_KEYS: { key: string; label: string; kind: 'num' | 'bool' }[] = [
  { key: 'portfolios', label: 'Portfolios', kind: 'num' },
  { key: 'holdings', label: 'Holdings', kind: 'num' },
  { key: 'goals', label: 'Goals', kind: 'num' },
  { key: 'alerts', label: 'Alerts', kind: 'num' },
  { key: 'ai_month', label: 'AI questions a month', kind: 'num' },
  { key: 'ai_usd_month', label: 'AI cost cap a month (US$)', kind: 'num' },
  { key: 'pro_screens', label: 'Pro screens and alerts', kind: 'bool' },
  { key: 'email_alerts', label: 'Email alerts', kind: 'bool' },
  { key: 'import', label: 'Statement screenshots', kind: 'bool' },
];

function Plans() {
  const p = useLoad(() => rows<Json[]>(sb.from('plans').select('*').order('sort')));
  const [edit, setEdit] = useState<Json | null>(null);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Loading error={p.error} loading={p.loading && !p.data} />
      {p.data && (
        <Card flush title="Plans" sub="Prices and limits apply at once. Card checkout needs the Safepay plan IDs for each period.">
          <div className="table-wrap"><table className="t compact"><thead><tr><th>Plan</th><th className="num">Monthly</th><th className="num">Yearly</th><th>Limits</th><th>Safepay</th><th>Shown</th><th /></tr></thead><tbody>
            {p.data.map((r) => (
              <tr key={r.id}>
                <td className="strong">{r.name} <span className="tiny muted">{r.id}</span></td>
                <td className="num">{pkr(r.price_pkr_month)}<div className="tiny muted">${r.price_usd_month ?? '–'}</div></td>
                <td className="num">{pkr(r.price_pkr_year)}<div className="tiny muted">${r.price_usd_year ?? '–'}</div></td>
                <td className="tiny">{LIMIT_KEYS.map((k) => `${k.label}: ${k.kind === 'bool' ? (r.limits?.[k.key] ? 'yes' : 'no') : r.limits?.[k.key] ?? '–'}`).join(' · ')}</td>
                <td className="tiny mono">{r.safepay_plan_month || '–'} / {r.safepay_plan_year || '–'}</td>
                <td>{r.public ? 'Yes' : 'No'}</td>
                <td className="num"><Button size="sm" variant="ghost" iconOnly icon="edit" onClick={() => setEdit(JSON.parse(JSON.stringify(r)))}>Edit {r.name}</Button></td>
              </tr>
            ))}
          </tbody></table></div>
        </Card>
      )}
      {edit && <PlanEditor plan={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); p.reload(); }} />}
    </div>
  );
}

function PlanEditor({ plan, onClose, onSaved }: { plan: Json; onClose: () => void; onSaved: () => void }) {
  const [x, setX] = useState<Json>(plan);
  const [features, setFeatures] = useState<string>((plan.features ?? []).join('\n'));
  const [err, setErr] = useState('');
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const setLimit = (k: string, v: unknown) => setX({ ...x, limits: { ...(x.limits ?? {}), [k]: v } });
  const save = async () => {
    setErr('');
    try {
      await act('plan.update', {
        id: x.id,
        patch: {
          name: x.name, price_pkr_month: x.price_pkr_month, price_pkr_year: x.price_pkr_year, price_usd_month: x.price_usd_month, price_usd_year: x.price_usd_year,
          limits: x.limits, features: features.split('\n').map((s) => s.trim()).filter(Boolean),
          safepay_plan_month: x.safepay_plan_month || null, safepay_plan_year: x.safepay_plan_year || null, public: !!x.public, sort: Number(x.sort) || 0,
        },
      });
      onSaved();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <Modal wide title={`Edit ${plan.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save plan</Button></>}>
      <div className="stack" style={{ gap: 12 }}>
        {err && <Callout tone="warn">{err}</Callout>}
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Name"><input className="input" value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} /></Field>
          <Field label="Rs a month"><input className="input num" style={{ width: 110 }} value={x.price_pkr_month ?? ''} onChange={(e) => setX({ ...x, price_pkr_month: num(e.target.value) })} /></Field>
          <Field label="Rs a year"><input className="input num" style={{ width: 110 }} value={x.price_pkr_year ?? ''} onChange={(e) => setX({ ...x, price_pkr_year: num(e.target.value) })} /></Field>
          <Field label="US$ a month"><input className="input num" style={{ width: 90 }} value={x.price_usd_month ?? ''} onChange={(e) => setX({ ...x, price_usd_month: num(e.target.value) })} /></Field>
          <Field label="US$ a year"><input className="input num" style={{ width: 90 }} value={x.price_usd_year ?? ''} onChange={(e) => setX({ ...x, price_usd_year: num(e.target.value) })} /></Field>
          <Field label="Order"><input className="input num" style={{ width: 70 }} value={x.sort ?? 0} onChange={(e) => setX({ ...x, sort: e.target.value })} /></Field>
          <Toggle checked={!!x.public} onChange={(v) => setX({ ...x, public: v })} label="Show on pricing" />
        </div>
        <div className="small strong">Limits</div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          {LIMIT_KEYS.map((k) => k.kind === 'num' ? (
            <Field key={k.key} label={k.label}><input className="input num" style={{ width: 120 }} value={x.limits?.[k.key] ?? ''} onChange={(e) => setLimit(k.key, num(e.target.value))} /></Field>
          ) : (
            <Toggle key={k.key} checked={!!x.limits?.[k.key]} onChange={(v) => setLimit(k.key, v)} label={k.label} />
          ))}
        </div>
        <Field label="Features shown on pricing (one per line)"><textarea className="input" rows={6} value={features} onChange={(e) => setFeatures(e.target.value)} /></Field>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Safepay plan ID, monthly"><input className="input mono" value={x.safepay_plan_month ?? ''} onChange={(e) => setX({ ...x, safepay_plan_month: e.target.value })} /></Field>
          <Field label="Safepay plan ID, yearly"><input className="input mono" value={x.safepay_plan_year ?? ''} onChange={(e) => setX({ ...x, safepay_plan_year: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function Coupons() {
  const c = useLoad(() => rows<Json[]>(sb.from('coupons').select('*').order('created_at', { ascending: false })));
  const [code, setCode] = useState('');
  const [days, setDays] = useState('30');
  const [max, setMax] = useState('');
  const [expires, setExpires] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null);
  const create = async () => {
    setMsg(null);
    try {
      await act('coupon.create', { code, value: Number(days), max_redemptions: max ? Number(max) : null, expires_at: expires ? new Date(`${expires}T23:59:59+05:00`).toISOString() : null, note });
      setMsg({ tone: 'good', text: `Code ${code.toUpperCase()} created.` });
      setCode('');
      c.reload();
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
    }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Card title="New gift code" sub="Each code adds Pro days to the account that redeems it, once per person.">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Code"><input className="input mono" style={{ width: 150 }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LAUNCH30" /></Field>
          <Field label="Pro days"><input className="input num" style={{ width: 90 }} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
          <Field label="Uses (blank for no limit)"><input className="input num" style={{ width: 110 }} value={max} onChange={(e) => setMax(e.target.value)} /></Field>
          <Field label="Expires"><input type="date" className="input" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
          <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Button variant="primary" disabled={code.length < 4} onClick={create}>Create</Button>
        </div>
        {msg && <div style={{ marginTop: 10 }}><Callout tone={msg.tone}>{msg.text}</Callout></div>}
      </Card>
      <Loading error={c.error} loading={c.loading && !c.data} />
      {c.data && (
        <Card flush title="Codes">
          <div className="table-wrap"><table className="t compact"><thead><tr><th>Code</th><th className="num">Days</th><th className="num">Used</th><th>Expires</th><th>Note</th><th>Active</th></tr></thead><tbody>
            {c.data.map((r) => (
              <tr key={r.code}>
                <td className="mono strong">{r.code}</td>
                <td className="num">{r.value}</td>
                <td className="num">{r.redeemed}{r.max_redemptions ? ` / ${r.max_redemptions}` : ''}</td>
                <td>{d(r.expires_at)}</td>
                <td className="small">{r.note ?? ''}</td>
                <td><Toggle checked={!!r.active} onChange={async (v) => { await act('coupon.update', { code: r.code, active: v }); c.reload(); }} label={r.active ? 'On' : 'Off'} /></td>
              </tr>
            ))}
          </tbody></table></div>
        </Card>
      )}
    </div>
  );
}

function Events() {
  const e = useLoad(() => rows<Json[]>(sb.from('billing_events').select('*').order('received_at', { ascending: false }).limit(100)));
  const [open, setOpen] = useState<Json | null>(null);
  return (
    <Card flush title="Payment events" sub="Every Safepay webhook as received. A bad signature usually means the webhook secret is wrong.">
      <Loading error={e.error} loading={e.loading && !e.data} />
      {e.data && (e.data.length === 0 ? <div className="small muted" style={{ padding: 16 }}>No events yet.</div> : (
        <div className="table-wrap"><table className="t compact"><thead><tr><th>Received</th><th>Type</th><th>Signature</th><th>Processed</th><th>Result</th><th /></tr></thead><tbody>
          {e.data.map((r) => (
            <tr key={r.id}>
              <td>{dt(r.received_at)}</td>
              <td>{r.type}</td>
              <td>{r.signature_ok ? <Pill tone="good">OK</Pill> : <Pill tone="critical">Bad</Pill>}</td>
              <td>{r.processed ? 'Yes' : r.error ? <Pill tone="critical">Error</Pill> : 'No'}</td>
              <td className="tiny">{r.error ?? (r.result ? JSON.stringify(r.result).slice(0, 100) : '')}</td>
              <td className="num"><Button size="sm" variant="ghost" onClick={() => setOpen(r)}>View</Button></td>
            </tr>
          ))}
        </tbody></table></div>
      ))}
      {open && <Modal wide title={`Event ${open.id}`} onClose={() => setOpen(null)}><JsonView value={open} /></Modal>}
    </Card>
  );
}

