// Back-office users: search, plan and usage at a glance, and a detail view with support actions.
import React, { useState } from 'react';
import { sb, errorText } from '../supabase';
import { act, d, dt, JsonView, Loading, n, planLabel, pkr, rows, usd, useLoad, type Json } from './common';
import { Badge, Button, Callout, Card, Field, KV, Modal, Pill, Select, Tabs, Toggle } from '../../ui/components/primitives';

const PAGE = 50;

export function Users() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => rows<Json>(sb.rpc('admin_users', { q: term, lim: PAGE, off: page * PAGE })), [term, page]);
  const total = list.data?.total ?? 0;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setPage(0); setTerm(q.trim()); }}>
        <input className="input" style={{ maxWidth: 360 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email, name or user ID" aria-label="Search users" />
        <Button type="submit" icon="search">Search</Button>
        {term && <button type="button" className="linkbtn small" onClick={() => { setQ(''); setTerm(''); setPage(0); }}>Clear</button>}
        <span className="small muted">{n(total)} {total === 1 ? 'person' : 'people'}</span>
      </form>
      <Loading error={list.error} loading={list.loading && !list.data} />
      {list.data && (
        <Card flush>
          <div className="table-wrap">
            <table className="t compact">
              <thead><tr><th>Person</th><th>Plan</th><th>Joined</th><th>Last seen</th><th className="num">AI this month</th><th>Portfolio</th></tr></thead>
              <tbody>
                {(list.data.rows as Json[]).map((u) => (
                  <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(u.id)}>
                    <td>
                      <div className="cell-name">
                        <span className="n1">{u.email ?? u.id} {u.role === 'admin' && <Badge tone="accent">Admin</Badge>} {u.disabled && <Pill tone="critical">Disabled</Pill>}</span>
                        <span className="n2">{u.name ?? ''}</span>
                      </div>
                    </td>
                    <td>{planLabel(u.plan)}</td>
                    <td>{d(u.createdAt)}</td>
                    <td>{u.lastSeenAt ? d(u.lastSeenAt) : 'Never'}</td>
                    <td className="num">{n(u.aiMonth)}</td>
                    <td>{u.hasWorkspace ? 'Yes' : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > PAGE && (
            <div className="card-f">
              <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="small muted">Page {page + 1} of {Math.ceil(total / PAGE)}</span>
              <Button size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </Card>
      )}
      {open && <UserDetail id={open} onClose={() => { setOpen(null); list.reload(); }} />}
    </div>
  );
}

type Tab = 'overview' | 'billing' | 'actions' | 'activity';

function UserDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const u = useLoad(() => rows<Json>(sb.rpc('admin_user_detail', { uid: id })), [id]);
  const [tab, setTab] = useState<Tab>('overview');
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const x = u.data;
  const p = x?.profile;

  const run = async (action: string, payload: Json, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await act(action, { userId: id, ...payload });
      setMsg({ tone: 'good', text: ok });
      u.reload();
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
    }
    setBusy(false);
  };

  return (
    <Modal wide title={p?.email ?? 'User'} onClose={onClose}>
      <Loading error={u.error} loading={u.loading && !x} />
      {x && p && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 8 }}>
            <Badge tone="accent">{planLabel(x.plan)}</Badge>
            {p.role === 'admin' && <Badge tone="accent">Admin</Badge>}
            {p.disabled && <Pill tone="critical">Disabled</Pill>}
            <span className="small muted">Joined {d(p.created_at)} · last seen {p.last_seen_at ? dt(p.last_seen_at) : 'never'}</span>
          </div>
          <Tabs value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'billing', label: 'Plan and payments' }, { value: 'actions', label: 'Actions' }, { value: 'activity', label: 'Activity' }]} label="User sections" />
          {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
          {tab === 'overview' && (
            <div className="grid" style={{ gap: 12 }}>
              <div className="card span-6" style={{ padding: 14 }}>
                <KV rows={[
                  ['Name', p.full_name ?? '–'],
                  ['User ID', <span className="mono tiny">{p.id}</span>],
                  ['Referral code', p.referralCode ?? '–'],
                  ['Referred by', x.referredBy ?? '–'],
                  ['People they referred', n(x.referrals)],
                  ['News emails', p.marketing_opt_in ? 'Yes' : 'No'],
                  ['Weekly digest', x.prefs?.digest ?? '–'],
                ]} />
              </div>
              <div className="card span-6" style={{ padding: 14 }}>
                <KV rows={[
                  ['Portfolios', n(x.workspace?.portfolios ?? 0)],
                  ['Holdings', n(x.workspace?.holdings ?? 0)],
                  ['Goals', n(x.workspace?.goals ?? 0)],
                  ['Workspace saved', x.workspace ? dt(x.workspace.updatedAt) : 'Never'],
                  ['Active alerts', n(x.alerts)],
                  ['Unread notifications', n(x.unread)],
                  ['AI this month', `${n(x.ai?.month)} questions · ${usd(x.ai?.monthCost)}`],
                  ['AI all time', `${n(x.ai?.total)} questions · ${usd(x.ai?.totalCost)}`],
                ]} />
              </div>
              <p className="tiny muted span-12" style={{ margin: 0 }}>Holdings stay private: the back office shows counts only.</p>
            </div>
          )}
          {tab === 'billing' && <BillingTab x={x} reload={u.reload} />}
          {tab === 'actions' && <ActionsTab x={x} busy={busy} run={run} onDeleted={onClose} />}
          {tab === 'activity' && (
            <div className="stack" style={{ gap: 12 }}>
              <div className="small strong">Emails</div>
              <div className="table-wrap"><table className="t compact"><thead><tr><th>When</th><th>Kind</th><th>Subject</th><th>Status</th></tr></thead><tbody>
                {(x.emails as Json[]).map((e, i) => <tr key={i}><td>{dt(e.at)}</td><td>{e.kind}</td><td>{e.subject}</td><td>{e.status}{e.error ? ` · ${e.error}` : ''}</td></tr>)}
              </tbody></table></div>
              <div className="small strong">Messages</div>
              {(x.feedback as Json[]).length === 0 ? <div className="small muted">None</div> : (x.feedback as Json[]).map((f) => (
                <div key={f.id} className="card tint" style={{ padding: 10 }}><div className="tiny muted">{dt(f.created_at)} · {f.kind} · {f.status}</div><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{f.message}</div>{f.reply && <div className="w-reply small"><strong>Reply:</strong> {f.reply}</div>}</div>
              ))}
              <div className="small strong">Audit</div>
              <div className="table-wrap"><table className="t compact"><thead><tr><th>When</th><th>Action</th><th>By</th><th>Details</th></tr></thead><tbody>
                {(x.audit as Json[]).map((a, i) => <tr key={i}><td>{dt(a.at)}</td><td>{a.action}</td><td>{a.actor ?? '–'}</td><td className="tiny mono">{a.after ? JSON.stringify(a.after).slice(0, 120) : ''}</td></tr>)}
              </tbody></table></div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function BillingTab({ x, reload }: { x: Json; reload: () => void }) {
  const [edit, setEdit] = useState<Json | null>(null);
  const [err, setErr] = useState('');
  const save = async () => {
    try {
      await act('subscription.update', { id: edit!.id, patch: { status: edit!.status, current_period_end: edit!.current_period_end || null, cancel_at_period_end: !!edit!.cancel_at_period_end, note: edit!.note ?? null } });
      setEdit(null);
      reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="small strong">Plan in force</div>
      <JsonView value={x.plan} />
      <div className="small strong">Subscriptions</div>
      <div className="table-wrap"><table className="t compact"><thead><tr><th>Plan</th><th>Status</th><th>Source</th><th>From</th><th>Until</th><th>Note</th><th /></tr></thead><tbody>
        {(x.subscriptions as Json[]).map((s) => (
          <tr key={s.id}>
            <td>{s.plan_id}{s.interval ? `, ${s.interval}ly` : ''}</td>
            <td>{s.status}{s.cancel_at_period_end ? ' (ends)' : ''}</td>
            <td>{s.source}</td>
            <td>{d(s.current_period_start)}</td>
            <td>{d(s.current_period_end)}</td>
            <td className="small">{s.note ?? ''}</td>
            <td className="num"><Button size="sm" variant="ghost" iconOnly icon="edit" onClick={() => setEdit({ ...s, current_period_end: s.current_period_end ? String(s.current_period_end).slice(0, 10) : '' })}>Edit</Button></td>
          </tr>
        ))}
      </tbody></table></div>
      {edit && (
        <div className="card tint" style={{ padding: 12 }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Status"><Select value={edit.status} onChange={(v) => setEdit({ ...edit, status: v })} options={['trialing', 'active', 'past_due', 'canceled', 'expired'].map((v) => ({ value: v, label: v }))} ariaLabel="Status" /></Field>
            <Field label="Until"><input type="date" className="input" value={edit.current_period_end} onChange={(e) => setEdit({ ...edit, current_period_end: e.target.value })} /></Field>
            <Field label="Note"><input className="input" value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
            <Toggle checked={!!edit.cancel_at_period_end} onChange={(v) => setEdit({ ...edit, cancel_at_period_end: v })} label="Ends at period end" />
            <Button variant="primary" onClick={save}>Save</Button>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          </div>
          {err && <Callout tone="warn">{err}</Callout>}
        </div>
      )}
      <div className="small strong">Payments</div>
      <div className="table-wrap"><table className="t compact"><thead><tr><th>Date</th><th>Plan</th><th className="num">Amount</th><th>Provider</th><th>Reference</th><th>Status</th></tr></thead><tbody>
        {(x.payments as Json[]).map((p) => <tr key={p.id}><td>{dt(p.created_at)}</td><td>{p.plan_id}{p.interval ? `, ${p.interval}ly` : ''}</td><td className="num">{p.currency === 'PKR' || !p.currency ? pkr(p.amount) : `${p.currency} ${p.amount}`}</td><td>{p.provider}</td><td className="tiny mono">{p.provider_ref ?? ''}</td><td>{p.status}</td></tr>)}
      </tbody></table></div>
    </div>
  );
}

function ActionsTab({ x, busy, run, onDeleted }: { x: Json; busy: boolean; run: (action: string, payload: Json, ok: string) => Promise<void>; onDeleted: () => void }) {
  const p = x.profile;
  const [days, setDays] = useState('30');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [interval, setIntervalKind] = useState<'month' | 'year'>('month');
  const [ref, setRef] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState(false);
  const [confirm, setConfirm] = useState('');
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card tint" style={{ padding: 12 }}>
        <div className="small strong" style={{ marginBottom: 8 }}>Give Pro</div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Days"><input className="input num" style={{ width: 90 }} value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" /></Field>
          <Field label="Note (shown in their history)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Beta tester" /></Field>
          <Button variant="primary" disabled={busy} onClick={() => run('user.grant', { plan: 'pro', days: Number(days), note: note || 'Granted by admin' }, `Pro added for ${days} days.`)}>Give Pro</Button>
        </div>
      </div>
      <div className="card tint" style={{ padding: 12 }}>
        <div className="small strong" style={{ marginBottom: 8 }}>Record a payment received outside the card gateway</div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Period"><Select value={interval} onChange={setIntervalKind} options={[{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }]} ariaLabel="Period" /></Field>
          <Field label="Amount (Rs)"><input className="input num" style={{ width: 110 }} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
          <Field label="Reference"><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Bank or wallet ref" /></Field>
          <Button variant="primary" disabled={busy || !amount} onClick={() => run('payment.record', { plan: 'pro', interval, amount: Number(amount), currency: 'PKR', ref, note: `Manual payment${ref ? ` ${ref}` : ''}` }, 'Payment recorded and Pro switched on.')}>Record</Button>
        </div>
      </div>
      <div className="card tint" style={{ padding: 12 }}>
        <div className="small strong" style={{ marginBottom: 8 }}>Send a message</div>
        <div className="stack" style={{ gap: 8 }}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" />
          <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message" aria-label="Message" />
          <div className="row">
            <Toggle checked={email} onChange={setEmail} label="Also email it" />
            <Button disabled={busy || !title.trim()} onClick={() => run('user.notify', { title, body, email }, 'Message sent.')}>Send</Button>
          </div>
        </div>
      </div>
      <div className="row">
        <Button disabled={busy} onClick={() => run('user.reset_ai', {}, 'AI allowance reset for this month.')}>Reset AI allowance</Button>
        <Button disabled={busy} onClick={() => run('user.role', { role: p.role === 'admin' ? 'user' : 'admin' }, 'Role changed.')}>{p.role === 'admin' ? 'Remove admin' : 'Make admin'}</Button>
        <Button variant="danger" disabled={busy} onClick={() => run('user.disable', { disabled: !p.disabled }, p.disabled ? 'Account enabled.' : 'Account disabled and signed out.')}>{p.disabled ? 'Enable account' : 'Disable account'}</Button>
      </div>
      <div className="card" style={{ padding: 12, borderColor: 'var(--critical)' }}>
        <div className="small strong" style={{ color: 'var(--critical-ink)', marginBottom: 6 }}>Delete this account</div>
        <div className="small ink2" style={{ marginBottom: 8 }}>Removes the account and all its data for good. Type their email to confirm.</div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={p.email ?? ''} aria-label="Type the email to confirm" />
          <Button variant="danger" disabled={busy || confirm.trim().toLowerCase() !== String(p.email ?? '').toLowerCase()} onClick={async () => { await run('user.delete', {}, 'Account deleted.'); onDeleted(); }}>Delete</Button>
        </div>
      </div>
    </div>
  );
}
