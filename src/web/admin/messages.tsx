// Back-office messages: announcements (banner, bell and optional email), the feedback inbox with
// replies, and the email delivery log.
import React, { useState } from 'react';
import { sb, errorText } from '../supabase';
import { act, dt, Loading, rows, useLoad, type Json } from './common';
import { Button, Callout, Card, Field, Pill, Select, Tabs } from '../../ui/components/primitives';

type Tab = 'feedback' | 'announcements' | 'emails';

export function Messages({ initial = 'feedback' }: { initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Tabs value={tab} onChange={setTab} options={[{ value: 'feedback', label: 'Feedback inbox' }, { value: 'announcements', label: 'Announcements' }, { value: 'emails', label: 'Email log' }]} label="Message sections" />
      {tab === 'feedback' && <Inbox />}
      {tab === 'announcements' && <Announcements />}
      {tab === 'emails' && <EmailLog />}
    </div>
  );
}

function Inbox() {
  const [status, setStatus] = useState<'open' | 'answered' | 'closed' | 'all'>('open');
  const f = useLoad(async () => {
    let q = sb.from('feedback').select('*').order('created_at', { ascending: false }).limit(200);
    if (status !== 'all') q = q.eq('status', status);
    return rows<Json[]>(q);
  }, [status]);
  const [reply, setReply] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null);
  const send = async (id: number) => {
    setMsg(null);
    try {
      const out = await act<{ emailed: boolean }>('feedback.reply', { id, reply: reply[id] ?? '' });
      setMsg({ tone: 'good', text: out.emailed ? 'Reply sent in the app and by email.' : 'Reply sent in the app.' });
      setReply({ ...reply, [id]: '' });
      f.reload();
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
    }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row">
        <Select value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'answered', label: 'Answered' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }]} ariaLabel="Status" />
      </div>
      {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
      <Loading error={f.error} loading={f.loading && !f.data} />
      {f.data && f.data.length === 0 && <div className="small muted">Nothing here.</div>}
      {f.data?.map((r) => (
        <Card key={r.id}>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row-between">
              <span className="small"><strong>{r.email ?? 'Unknown'}</strong> <span className="muted">· {r.kind} · {dt(r.created_at)}</span></span>
              <Pill tone={r.status === 'open' ? 'warn' : r.status === 'answered' ? 'good' : 'neutral'}>{r.status}</Pill>
            </div>
            <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{r.message}</div>
            {r.reply && <div className="w-reply small"><strong>Replied {dt(r.replied_at)}:</strong> {r.reply}</div>}
            {r.status !== 'closed' && (
              <>
                <textarea className="input" rows={3} value={reply[r.id] ?? ''} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} placeholder="Write a reply (sent in the app and by email)" aria-label="Reply" />
                <div className="row">
                  <Button variant="primary" icon="send" disabled={!(reply[r.id] ?? '').trim()} onClick={() => send(r.id)}>Reply</Button>
                  <Button variant="ghost" onClick={async () => { await act('feedback.status', { id: r.id, status: 'closed' }); f.reload(); }}>Close</Button>
                </div>
              </>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

const blank = { id: null as number | null, title: '', body: '', link: '', audience: 'all', starts_at: '', ends_at: '' };

function Announcements() {
  const a = useLoad(() => rows<Json[]>(sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(50)));
  const [x, setX] = useState({ ...blank });
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null);
  const local = (iso: string) => (iso ? new Date(`${iso}T00:00:00+05:00`).toISOString() : '');
  const save = async () => {
    setMsg(null);
    try {
      await act('announcement.save', { id: x.id ?? undefined, title: x.title, body: x.body, link: x.link, audience: x.audience, starts_at: local(x.starts_at) || undefined, ends_at: local(x.ends_at) || null });
      setMsg({ tone: 'good', text: 'Saved. It shows as a banner while it is live.' });
      setX({ ...blank });
      a.reload();
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
    }
  };
  const email = async (id: number) => {
    setMsg(null);
    try {
      const out = await act<{ sent: number; skipped: number }>('announcement.email', { id });
      setMsg({ tone: 'good', text: `Emailed ${out.sent} people (${out.skipped} skipped: not opted in, or not in the audience).` });
      a.reload();
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
    }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Card title={x.id ? 'Edit announcement' : 'New announcement'} sub="Shows as a banner in the app for signed-in people while it is live. Email goes only to people who opted in to news.">
        <div className="stack" style={{ gap: 10 }}>
          <input className="input" value={x.title} onChange={(e) => setX({ ...x, title: e.target.value })} placeholder="Title" aria-label="Title" maxLength={140} />
          <textarea className="input" rows={3} value={x.body} onChange={(e) => setX({ ...x, body: e.target.value })} placeholder="Short message" aria-label="Message" />
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Link (optional)"><input className="input" value={x.link} onChange={(e) => setX({ ...x, link: e.target.value })} placeholder="https://" /></Field>
            <Field label="Audience"><Select value={x.audience} onChange={(v) => setX({ ...x, audience: v })} options={[{ value: 'all', label: 'Everyone' }, { value: 'free', label: 'Free and trial' }, { value: 'paid', label: 'Paying' }]} ariaLabel="Audience" /></Field>
            <Field label="Starts"><input type="date" className="input" value={x.starts_at} onChange={(e) => setX({ ...x, starts_at: e.target.value })} /></Field>
            <Field label="Ends (optional)"><input type="date" className="input" value={x.ends_at} onChange={(e) => setX({ ...x, ends_at: e.target.value })} /></Field>
            <Button variant="primary" disabled={!x.title.trim()} onClick={save}>Save</Button>
            {x.id && <Button variant="ghost" onClick={() => setX({ ...blank })}>New instead</Button>}
          </div>
          {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
        </div>
      </Card>
      <Loading error={a.error} loading={a.loading && !a.data} />
      {a.data && (
        <Card flush title="Announcements">
          <div className="table-wrap"><table className="t compact"><thead><tr><th>Title</th><th>Audience</th><th>Live</th><th>Emailed</th><th /></tr></thead><tbody>
            {a.data.map((r) => {
              const live = Date.parse(r.starts_at) <= Date.now() && (!r.ends_at || Date.parse(r.ends_at) > Date.now());
              return (
                <tr key={r.id}>
                  <td><div className="strong small">{r.title}</div><div className="tiny muted">{r.body ?? ''}</div></td>
                  <td>{r.audience}</td>
                  <td>{live ? <Pill tone="good">Live</Pill> : Date.parse(r.starts_at) > Date.now() ? 'Scheduled' : 'Ended'}</td>
                  <td>{r.emailed_at ? dt(r.emailed_at) : '–'}</td>
                  <td className="num">
                    <div className="row-actions">
                      <Button size="sm" variant="ghost" iconOnly icon="edit" onClick={() => setX({ id: r.id, title: r.title, body: r.body ?? '', link: r.link ?? '', audience: r.audience, starts_at: String(r.starts_at).slice(0, 10), ends_at: r.ends_at ? String(r.ends_at).slice(0, 10) : '' })}>Edit</Button>
                      <Button size="sm" variant="ghost" iconOnly icon="mail" disabled={!!r.emailed_at} onClick={() => email(r.id)}>Email it</Button>
                      <Button size="sm" variant="ghost" iconOnly icon="trash" onClick={async () => { await act('announcement.delete', { id: r.id }); a.reload(); }}>Delete</Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody></table></div>
        </Card>
      )}
    </div>
  );
}

function EmailLog() {
  const [status, setStatus] = useState<'all' | 'failed'>('all');
  const e = useLoad(async () => {
    let q = sb.from('email_log').select('*').order('created_at', { ascending: false }).limit(200);
    if (status === 'failed') q = q.in('status', ['failed', 'bounced', 'complained', 'skipped']);
    return rows<Json[]>(q);
  }, [status]);
  return (
    <Card flush title="Emails" actions={<Select value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'failed', label: 'Problems only' }]} ariaLabel="Filter" />}>
      <Loading error={e.error} loading={e.loading && !e.data} />
      {e.data && (
        <div className="table-wrap"><table className="t compact"><thead><tr><th>When</th><th>To</th><th>Kind</th><th>Subject</th><th>Status</th></tr></thead><tbody>
          {e.data.map((r) => <tr key={r.id}><td>{dt(r.created_at)}</td><td>{r.to_email}</td><td>{r.kind}</td><td className="small">{r.subject}</td><td>{r.status === 'sent' || r.status === 'delivered' ? r.status : <span style={{ color: 'var(--critical-ink)' }}>{r.status}{r.error ? `: ${r.error}` : ''}</span>}</td></tr>)}
        </tbody></table></div>
      )}
    </Card>
  );
}
