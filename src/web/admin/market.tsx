// Back-office market data: what the app shows, where each number came from, and a way to correct a
// figure (an admin patch beats the scrapers for that day; the next load applies it).
import React, { useState } from 'react';
import { sb, runJob, errorText } from '../supabase';
import { act, d, dt, JsonView, Loading, n, rows, useLoad, type Json } from './common';
import { Button, Callout, Card, Field, Modal, Select } from '../../ui/components/primitives';

const FIELDS: { key: string; label: string; path: string }[] = [
  { key: 'policyRate', label: 'SBP policy rate (%)', path: 'policyRate' },
  { key: 'kse100', label: 'KSE-100', path: 'kse100' },
  { key: 'goldTola', label: 'Gold, 24k per tola (Rs)', path: 'goldTola' },
  { key: 'silverTola', label: 'Silver per tola (Rs)', path: 'silverTola' },
  { key: 'fx.USD', label: 'US dollar (Rs)', path: 'fx.USD' },
  { key: 'cpi', label: 'CPI inflation (%)', path: 'cpi' },
  { key: 'tbill.m3', label: '3-month T-bill (%)', path: 'tbill.m3' },
  { key: 'tbill.m6', label: '6-month T-bill (%)', path: 'tbill.m6' },
  { key: 'tbill.m12', label: '12-month T-bill (%)', path: 'tbill.m12' },
  { key: 'nss.RIC', label: 'NSS: Regular Income (%)', path: 'nss.RIC' },
  { key: 'nss.BSC', label: 'NSS: Behbood (%)', path: 'nss.BSC' },
  { key: 'nss.SSC', label: 'NSS: Special Savings (%)', path: 'nss.SSC' },
  { key: 'nss.DSC', label: 'NSS: Defence Savings (%)', path: 'nss.DSC' },
  { key: 'nss.STSC', label: 'NSS: Short Term (%)', path: 'nss.STSC' },
  { key: 'nss.SITA3', label: 'NSS: Sarwa Islamic 3 years (%)', path: 'nss.SITA3' },
  { key: 'nss.SITA5', label: 'NSS: Sarwa Islamic 5 years (%)', path: 'nss.SITA5' },
];

function get(obj: Json, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Json)[k] : undefined), obj);
}

export function Market() {
  const docs = useLoad(() => rows<Json[]>(sb.from('market_docs').select('id, doc, updated_at')));
  const patches = useLoad(() => rows<Json[]>(sb.from('market_patches').select('id, created_at, source, note, patch').order('created_at', { ascending: false }).limit(20)));
  const runs = useLoad(() => rows<Json[]>(sb.from('job_runs').select('id, job, ran_at, ok, info').order('ran_at', { ascending: false }).limit(30)));
  const [field, setField] = useState(FIELDS[0].key);
  const [value, setValue] = useState('');
  const [date, setDate] = useState(new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null);
  const [view, setView] = useState<Json | null>(null);

  const latest = docs.data?.find((x) => x.id === 'latest')?.doc ?? null;
  const psx = docs.data?.find((x) => x.id === 'psx');
  const funds = docs.data?.find((x) => x.id === 'funds');

  const apply = async () => {
    const f = FIELDS.find((x) => x.key === field)!;
    const v = Number(value);
    if (!isFinite(v)) return setMsg({ tone: 'warn', text: 'Enter a number.' });
    setBusy(true);
    setMsg(null);
    // Build the patch in the scraper document's shape: market values, their dates and source.
    const market: Json = {};
    const parts = f.path.split('.');
    if (parts.length === 1) market[parts[0]] = v;
    else market[parts[0]] = { ...((latest?.market?.[parts[0]] as Json) ?? {}), [parts[1]]: v };
    const dateKey = parts[0] === 'nss' ? `nss.${parts[1]}` : parts[0];
    const patch: Json = { market, dates: { [dateKey]: date }, sources: { [parts[0] === 'nss' ? dateKey : parts[0]]: 'admin' }, notes: note ? [note] : [] };
    if (parts[0] === 'policyRate') patch.market.policyDate = date;
    try {
      await act('market.patch', { patch, note: note || `${f.label} set to ${v} from ${date}` });
      const out = await runJob<Json>('load-market');
      setMsg({ tone: out.ok === false ? 'warn' : 'good', text: out.ok === false ? `Saved, but the reload failed: ${out.error}` : `${f.label} set to ${v}. The app shows it now.` });
      setValue('');
      docs.reload();
      patches.reload();
      runs.reload();
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
    }
    setBusy(false);
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <Loading error={docs.error} loading={docs.loading && !docs.data} />
      {latest && (
        <Card title="Rates and prices" sub={`Built ${dt(latest.builtAt)} · stored ${dt(docs.data?.find((x) => x.id === 'latest')?.updated_at)}`} actions={<Button size="sm" variant="ghost" onClick={() => setView(latest)}>Raw</Button>}>
          {Array.isArray(latest.review) && latest.review.length > 0 && <Callout tone="warn">Needs review: {latest.review.join('; ')}</Callout>}
          <div className="table-wrap"><table className="t compact"><thead><tr><th>Figure</th><th className="num">Value</th><th>Date</th><th>Source</th></tr></thead><tbody>
            {FIELDS.map((f) => {
              const parts = f.path.split('.');
              const dateKey = parts[0] === 'nss' ? `nss.${parts[1]}` : parts[0];
              return (
                <tr key={f.key}>
                  <td>{f.label}</td>
                  <td className="num">{n(get(latest.market ?? {}, f.path))}</td>
                  <td>{d(latest.dates?.[dateKey])}</td>
                  <td className="small">{latest.sources?.[dateKey] ?? latest.sources?.[parts[0]] ?? ''}</td>
                </tr>
              );
            })}
          </tbody></table></div>
        </Card>
      )}
      <div className="grid">
        <div className="span-6">
          <Card title="PSX prices" sub={psx ? `${psx.doc?.count ?? '–'} securities · as of ${psx.doc?.asOf ?? '–'}${psx.doc?.intraday ? ' (intraday)' : ''}` : 'Not loaded yet'}>
            <div className="small ink2">Stored {dt(psx?.updated_at)}. Closing prices become each holding’s price and feed price history and alerts.</div>
          </Card>
        </div>
        <div className="span-6">
          <Card title="Fund NAVs" sub={funds ? `${funds.doc?.count ?? '–'} funds · report date ${funds.doc?.reportDate ?? '–'}` : 'Not loaded yet'}>
            <div className="small ink2">Stored {dt(funds?.updated_at)}. Linked fund holdings update to the newest NAV.</div>
          </Card>
        </div>
      </div>
      <Card title="Correct a figure" sub="Saved as an admin patch with its date; it wins over the scrapers for that date and the data reloads at once.">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Figure"><Select value={field} onChange={setField} options={FIELDS.map((f) => ({ value: f.key, label: f.label }))} ariaLabel="Figure" /></Field>
          <Field label="Value"><input className="input num" style={{ width: 120 }} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" /></Field>
          <Field label="Effective date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Note shown in the app (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} style={{ minWidth: 240 }} /></Field>
          <Button variant="primary" disabled={busy || !value} onClick={apply}>{busy ? 'Saving…' : 'Save and reload'}</Button>
        </div>
        {msg && <div style={{ marginTop: 10 }}><Callout tone={msg.tone}>{msg.text}</Callout></div>}
      </Card>
      <Card flush title="Patches" sub="From the daily research agent and from admins; the newest from the last three days applies.">
        <Loading error={patches.error} loading={patches.loading && !patches.data} />
        {patches.data && (
          <div className="table-wrap"><table className="t compact"><thead><tr><th>When</th><th>Source</th><th>Figures</th><th>Note</th><th /></tr></thead><tbody>
            {patches.data.map((p) => (
              <tr key={p.id}>
                <td>{dt(p.created_at)}</td>
                <td>{p.source}</td>
                <td className="small">{Object.keys(p.patch?.market ?? {}).join(', ')}</td>
                <td className="small">{p.note ?? ''}</td>
                <td className="num"><Button size="sm" variant="ghost" onClick={() => setView(p)}>View</Button></td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      <Card flush title="Recent job runs">
        <Loading error={runs.error} loading={runs.loading && !runs.data} />
        {runs.data && (
          <div className="table-wrap"><table className="t compact"><thead><tr><th>When</th><th>Job</th><th>OK</th><th>Details</th></tr></thead><tbody>
            {runs.data.map((r) => <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setView(r)}><td>{dt(r.ran_at)}</td><td>{r.job}</td><td>{r.ok ? 'Yes' : 'No'}</td><td className="tiny mono">{JSON.stringify(r.info).slice(0, 140)}</td></tr>)}
          </tbody></table></div>
        )}
      </Card>
      {view && <Modal wide title="Details" onClose={() => setView(null)}><JsonView value={view} /></Modal>}
    </div>
  );
}
