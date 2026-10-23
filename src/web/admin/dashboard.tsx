// Back-office dashboard: users, revenue, AI cost, email health, job runs and market data freshness.
import React, { useState } from 'react';
import { sb, runJob, errorText } from '../supabase';
import { Kpi, Loading, dt, n, pkr, usd, useLoad, rows, type Json } from './common';
import { StackedBars } from '../../ui/charts/charts';
import { useColors } from '../../ui/charts/base';
import { Button, Callout, Card, Pill } from '../../ui/components/primitives';

const JOBS: { id: string; label: string; body?: Json }[] = [
  { id: 'load-market', label: 'Load market data' },
  { id: 'notify', label: 'Send notifications' },
  { id: 'digest', label: 'Send weekly digest', body: { force: false } },
  { id: 'cleanup', label: 'Clean up' },
];

function summary(job: string, info: Json | null): string {
  if (!info) return '';
  if (info.error) return String(info.error).slice(0, 120);
  if (job === 'load-market') return `PSX ${info.psx?.count ?? '–'} · funds ${info.funds?.count ?? '–'} · history ${info.history ?? 0}${info.events?.length ? ` · events: ${info.events.join(', ')}` : ''}`;
  if (job === 'notify') return `${info.users ?? 0} users · ${info.notifications ?? 0} notifications · ${info.emails ?? 0} emails${info.errors?.length ? ` · ${info.errors.length} errors` : ''}`;
  if (job === 'digest') return `${info.sent ?? 0} sent · ${info.skipped ?? 0} skipped${info.errors?.length ? ` · ${info.errors.length} errors` : ''}`;
  return Object.entries(info).filter(([k]) => k !== 'ok').map(([k, v]) => `${k} ${typeof v === 'object' ? '' : v}`).join(' · ');
}

export function Dashboard() {
  const c = useColors();
  const m = useLoad(() => rows<Json>(sb.rpc('admin_metrics')));
  const s = useLoad(() => rows<Json[]>(sb.rpc('admin_series', { days: 30 })));
  const [running, setRunning] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null);
  const x = m.data;

  const run = async (id: string, body?: Json) => {
    setRunning(id);
    setMsg(null);
    try {
      const out = await runJob<Json>(id, body ?? {});
      setMsg({ tone: out.ok === false ? 'warn' : 'good', text: `${id}: ${summary(id, out) || 'done'}` });
      m.reload();
    } catch (e) {
      setMsg({ tone: 'warn', text: `${id}: ${errorText(e)}` });
    }
    setRunning(null);
  };

  const series = s.data ?? [];
  const labels = series.map((r) => String(r.d).slice(5));
  return (
    <div className="stack" style={{ gap: 18 }}>
      <Loading error={m.error} loading={m.loading && !x} />
      {x && (
        <>
          <div className="stats">
            <Kpi label="Users" value={n(x.users)} note={`${n(x.new7)} new this week · ${n(x.new30)} in 30 days`} />
            <Kpi label="Active" value={n(x.active7)} note={`${n(x.active1)} today · ${n(x.active30)} in 30 days`} />
            <Kpi label="Paying" value={n(x.paying + x.manual)} note={`${n(x.paying)} by card · ${n(x.manual)} manual${x.pastDue ? ` · ${n(x.pastDue)} past due` : ''}`} tone={x.pastDue ? 'warn' : undefined} />
            <Kpi label="On trial" value={n(x.trialing)} note={`${n(x.granted)} on codes or referrals`} />
            <Kpi label="Monthly revenue" value={pkr(x.mrrPkr)} note={`Last 30 days: ${Object.entries(x.revenue30 ?? {}).map(([cur, v]) => `${cur} ${n(Math.round(Number(v)))}`).join(', ') || 'none'}`} />
            <Kpi label="AI, 30 days" value={usd(x.ai30?.cost)} note={`${n(x.ai30?.questions)} questions · ${n(x.ai30?.users)} people`} />
            <Kpi label="Emails, 7 days" value={n(x.emails7?.sent)} note={`${n(x.emails7?.failed)} failed · ${n(x.emails7?.skipped)} skipped`} tone={x.emails7?.failed ? 'warn' : undefined} />
            <Kpi label="Open messages" value={n(x.feedbackOpen)} note={x.billingErrors7 ? `${x.billingErrors7} payment webhook problems this week` : `${n(x.notifications7)} notifications this week`} tone={x.billingErrors7 ? 'warn' : undefined} />
          </div>
          <div className="grid">
            <div className="span-6">
              <Card title="Sign-ups" sub="New accounts per day, last 30 days">
                {series.length > 0 && <StackedBars labels={labels} series={[{ name: 'Sign-ups', data: series.map((r) => Number(r.signups)), color: c.series[0] }]} fmtVal={(v) => n(v)} fmtAxis={(v) => n(v)} height={200} ariaLabel="Sign-ups per day" />}
              </Card>
            </div>
            <div className="span-6">
              <Card title="AI questions" sub="Questions per day, last 30 days">
                {series.length > 0 && <StackedBars labels={labels} series={[{ name: 'Questions', data: series.map((r) => Number(r.questions)), color: c.series[2] }]} fmtVal={(v) => n(v)} fmtAxis={(v) => n(v)} height={200} ariaLabel="AI questions per day" />}
                <div className="tiny muted">Cost over the period: {usd(series.reduce((t, r) => t + Number(r.aiCost ?? 0), 0))}</div>
              </Card>
            </div>
          </div>
          <Card title="Jobs" sub="Scheduled in Pakistan time: 08:50 load and notify, 09:40 second load, hourly catch-up 10:12 to 21:12, 17:25 on trading days, Sunday 09:30 digest, 03:15 clean-up">
            <div className="table-wrap">
              <table className="t compact">
                <thead><tr><th>Job</th><th>Last run</th><th>Result</th><th /></tr></thead>
                <tbody>
                  {JOBS.map((j) => {
                    const r = (x.jobs ?? []).find((y: Json) => y.job === j.id);
                    return (
                      <tr key={j.id}>
                        <td className="strong">{j.label}</td>
                        <td>{r ? dt(r.ranAt) : 'Never'}</td>
                        <td>{r ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Pill tone={r.ok ? 'good' : 'critical'}>{r.ok ? 'OK' : 'Failed'}</Pill><span className="tiny muted">{summary(j.id, r.info)}</span></span> : '–'}</td>
                        <td className="num"><Button size="sm" disabled={!!running} onClick={() => run(j.id, j.body)}>{running === j.id ? 'Running…' : 'Run now'}</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {msg && <div style={{ marginTop: 10 }}><Callout tone={msg.tone}>{msg.text}</Callout></div>}
          </Card>
          <Card title="Market data" sub="What the app shows everyone">
            <div className="table-wrap">
              <table className="t compact">
                <thead><tr><th>Document</th><th>As of</th><th>Built</th><th>Stored</th><th>Needs review</th></tr></thead>
                <tbody>
                  {['latest', 'psx', 'funds'].map((id) => {
                    const r = x.market?.[id];
                    const review: string[] = Array.isArray(r?.review) ? r.review : [];
                    return (
                      <tr key={id}>
                        <td className="strong">{id === 'latest' ? 'Rates and prices' : id === 'psx' ? 'PSX prices' : 'Fund NAVs'}</td>
                        <td>{r?.asOf ?? '–'}</td>
                        <td>{dt(r?.builtAt)}</td>
                        <td>{dt(r?.updatedAt)}</td>
                        <td className="small">{review.length ? review.join('; ') : id === 'latest' ? 'Nothing' : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
