// Back-office settings: service status, the switches and values the app reads, a test email, and
// the audit log of every admin action.
import React, { useState } from 'react';
import { sb, errorText } from '../supabase';
import { act, dt, Loading, rows, useLoad, type Json } from './common';
import { Button, Callout, Card, Pill, Tabs, Toggle } from '../../ui/components/primitives';

const HELP: Record<string, string> = {
  trial_days: 'Pro trial length for new accounts, in days (0 turns trials off).',
  payments_enabled: 'Show card checkout. Needs the Safepay keys and plan IDs.',
  safepay_env: '"sandbox" for testing, "production" for real payments.',
  ai_enabled: 'Switch the AI analyst off for everyone (maintenance).',
  ai_model: 'Model for the AI analyst, for example "claude-opus-5-5".',
  ai_model_quick: 'Model for quick reading tasks (statements, forms). "claude-haiku-5-5" costs far less.',
  ai_price: 'Dollar prices per million tokens, used for the cost log and cost caps.',
  email_from: 'Sender. Needs a verified domain in Resend to reach anyone but you.',
  support_email: 'The help address shown on the site and in the app, and where feedback arrives. Leave it empty to keep it private; feedback then goes to the admin emails.',
  app_url: 'The app’s public address, used in email links and checkout.',
  admin_emails: 'Emails that become admins when they sign up.',
  referral_reward_days: 'Pro days earned when someone you invited first pays.',
};

type Tab = 'settings' | 'audit';

export function Settings() {
  const [tab, setTab] = useState<Tab>('settings');
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Tabs value={tab} onChange={setTab} options={[{ value: 'settings', label: 'Settings' }, { value: 'audit', label: 'Audit log' }]} label="Settings sections" />
      {tab === 'settings' ? <SettingsList /> : <Audit />}
    </div>
  );
}

function Status() {
  const s = useLoad(() => act<Json>('status'));
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null);
  const test = async () => {
    setMsg(null);
    try {
      await act('email.test');
      setMsg({ tone: 'good', text: 'Test email sent to your address.' });
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
    }
  };
  const item = (ok: boolean | undefined, label: string, help: string) => (
    <div className="w-status">
      <Pill tone={ok ? 'good' : 'warn'}>{ok ? 'Set' : 'Missing'}</Pill>
      <div><div className="small strong">{label}</div><div className="tiny muted">{help}</div></div>
    </div>
  );
  return (
    <Card title="Services" sub="Keys live in Supabase (function secrets and Vault), never in the app or this page.">
      <Loading error={s.error} loading={s.loading && !s.data} />
      {s.data && (
        <div className="grid" style={{ gap: 10 }}>
          <div className="span-6">{item(s.data.anthropic, 'Claude API key', 'Function secret ANTHROPIC_API_KEY. Powers the AI analyst.')}</div>
          <div className="span-6">{item(s.data.resend, 'Resend key', 'Vault secret resend_api_key. Sends all email.')}</div>
          <div className="span-6">{item(s.data.safepay, 'Safepay secret key', 'Function secret SAFEPAY_SECRET_KEY. Card checkout and cancellations.')}</div>
          <div className="span-6">{item(s.data.safepayWebhook, 'Safepay webhook secret', `Function secret SAFEPAY_WEBHOOK_SECRET. Webhook address: ${s.data.webhookUrl ?? ''}`)}</div>
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}><Button icon="mail" onClick={test}>Send me a test email</Button></div>
      {msg && <div style={{ marginTop: 10 }}><Callout tone={msg.tone}>{msg.text}</Callout></div>}
    </Card>
  );
}

function SettingsList() {
  const s = useLoad(() => rows<Json[]>(sb.from('app_settings').select('*').order('key')));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null);
  const save = async (r: Json, raw: string, pub?: boolean) => {
    setMsg(null);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return setMsg({ tone: 'warn', text: `${r.key}: not valid JSON. Put text in double quotes, for example "claude-opus-5-5".` });
    }
    try {
      await act('setting.set', { key: r.key, value, public: pub ?? r.public });
      setMsg({ tone: 'good', text: `${r.key} saved.` });
      const next = { ...drafts };
      delete next[r.key];
      setDrafts(next);
      s.reload();
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
    }
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Status />
      <Card flush title="Settings" sub="Values are JSON. Public settings are readable by the app without signing in.">
        {msg && <div style={{ padding: '0 16px 10px' }}><Callout tone={msg.tone}>{msg.text}</Callout></div>}
        <Loading error={s.error} loading={s.loading && !s.data} />
        {s.data && (
          <div className="table-wrap"><table className="t compact"><thead><tr><th>Setting</th><th>Value</th><th>Public</th><th /></tr></thead><tbody>
            {s.data.map((r) => {
              const raw = drafts[r.key] ?? JSON.stringify(r.value);
              const changed = drafts[r.key] !== undefined && drafts[r.key] !== JSON.stringify(r.value);
              return (
                <tr key={r.key}>
                  <td style={{ minWidth: 200 }}><div className="strong small mono">{r.key}</div><div className="tiny muted">{HELP[r.key] ?? ''}</div></td>
                  <td style={{ width: '50%' }}>
                    {typeof r.value === 'boolean' ? (
                      <Toggle checked={r.value} onChange={(v) => save(r, JSON.stringify(v))} label={r.value ? 'On' : 'Off'} />
                    ) : (
                      <textarea className="input mono" rows={raw.length > 70 ? 3 : 1} value={raw} onChange={(e) => setDrafts({ ...drafts, [r.key]: e.target.value })} aria-label={r.key} style={{ fontSize: 12 }} />
                    )}
                  </td>
                  <td><Toggle checked={!!r.public} onChange={(v) => save(r, JSON.stringify(r.value), v)} label="" /></td>
                  <td className="num">{changed && <Button size="sm" variant="primary" onClick={() => save(r, raw)}>Save</Button>}</td>
                </tr>
              );
            })}
          </tbody></table></div>
        )}
      </Card>
    </div>
  );
}

function Audit() {
  const a = useLoad(async () => {
    const list = await rows<Json[]>(sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300));
    const ids = [...new Set(list.map((r) => r.actor).filter(Boolean))];
    const { data } = ids.length ? await sb.from('profiles').select('id, email').in('id', ids) : { data: [] as Json[] };
    const by = new Map((data ?? []).map((p: Json) => [p.id, p.email]));
    return list.map((r): Json => ({ ...r, actorEmail: by.get(r.actor) ?? (r.actor ? String(r.actor).slice(0, 8) : 'system') }));
  });
  return (
    <Card flush title="Audit log" sub="Every admin action, and account changes people make themselves.">
      <Loading error={a.error} loading={a.loading && !a.data} />
      {a.data && (
        <div className="table-wrap"><table className="t compact"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Change</th></tr></thead><tbody>
          {a.data.map((r) => <tr key={r.id}><td>{dt(r.at)}</td><td className="small">{r.actorEmail}</td><td className="small mono">{r.action}</td><td className="tiny mono">{r.target_type}{r.target_id ? `:${String(r.target_id).slice(0, 12)}` : ''}</td><td className="tiny mono">{r.after ? JSON.stringify(r.after).slice(0, 140) : ''}</td></tr>)}
        </tbody></table></div>
      )}
    </Card>
  );
}
