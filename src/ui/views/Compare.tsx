import React, { useEffect, useMemo, useState } from 'react';
import type { BuildOptions } from '../../engine/exposures';
import { todayISO, uid } from '../../engine/format';
import { MODEL_PORTFOLIOS, PROFILE_LABELS, PROFILE_ORDER } from '../../engine/optimize';
import { holdingShock, STRESS_PRESETS } from '../../engine/stress';
import type { RiskProfile } from '../../engine/types';
import { useForecast, type ForecastState } from '../../state/analytics';
import { useUI, useWS } from '../../state/store';
import { ChartFrame, LegendItem, useColors } from '../charts/base';
import { MultiLineChart } from '../charts/charts';
import { Button, Card, Field, NumberInput, Select, Slider, Spinner, Toggle } from '../components/primitives';
import { useFmt } from '../fmt';
import { ExampleBanner, PageHead } from './common';
import { forecastSeries } from './Overview';

type MixChoice = 'current' | 'target' | RiskProfile;

interface Scn {
  id: string;
  slot: number;
  name: string;
  sip: number;
  stepUp: number;
  mix: MixChoice;
  rebalance: boolean;
  shock: string;
}

// Scenarios survive switching screens during the visit (per portfolio).
const MEMORY = new Map<string, { scns: Scn[]; horizon: number }>();

function defaults(sip: number, stepUp: number, profile?: RiskProfile): Scn[] {
  return [
    { id: uid('sc'), slot: 0, name: 'Current plan', sip, stepUp, mix: 'current', rebalance: false, shock: '' },
    { id: uid('sc'), slot: 1, name: 'Invest 25% more', sip: Math.round((sip * 1.25) / 1000) * 1000 || 25_000, stepUp, mix: 'current', rebalance: false, shock: '' },
    { id: uid('sc'), slot: 2, name: `${PROFILE_LABELS[profile ?? 'balanced']} model mix`, sip, stepUp, mix: profile ?? 'balanced', rebalance: true, shock: '' },
  ];
}

function useScenario(scn: Scn | undefined, horizon: number): ForecastState {
  const { ws, active } = useWS();
  const preset = scn?.shock ? STRESS_PRESETS.find((s) => s.key === scn.shock) : undefined;
  const target = scn && scn.mix !== 'current' ? (scn.mix === 'target' ? active.targetMix : MODEL_PORTFOLIOS[scn.mix]) : undefined;
  const opts: BuildOptions & { enabled?: boolean; keyExtra?: string } = {
    enabled: !!scn,
    horizonYears: horizon,
    paths: Math.min(active.plan.paths, 2000),
    sipMonthly: scn?.sip ?? 0,
    sipStepUp: scn?.stepUp ?? 0,
    mixOverride: target,
    contributionMix: target ? 'target' : 'current',
    rebalance: scn?.rebalance ? (target ? 'annual_target' : 'annual_current') : 'none',
    perClass: false,
    samplePaths: 0,
    startShock: preset ? (h) => holdingShock(h, preset.shocks) : undefined,
    keyExtra: 'cmp:' + (scn?.shock ?? ''),
  };
  void ws;
  return useForecast(opts, active.holdings);
}

export function Compare() {
  const { ws, active } = useWS();
  const { askAI } = useUI();
  const fmt = useFmt();
  const colors = useColors();
  const mem = MEMORY.get(active.id);
  const [scns, setScns] = useState<Scn[]>(() => mem?.scns ?? defaults(active.plan.sipMonthly, active.plan.sipStepUp, ws.settings.riskProfile));
  const [horizon, setHorizon] = useState<number>(() => mem?.horizon ?? active.plan.horizonYears);
  useEffect(() => {
    MEMORY.set(active.id, { scns, horizon });
  }, [scns, horizon, active.id]);
  useEffect(() => {
    const m = MEMORY.get(active.id);
    setScns(m?.scns ?? defaults(active.plan.sipMonthly, active.plan.sipStepUp, ws.settings.riskProfile));
    setHorizon(m?.horizon ?? active.plan.horizonYears);
  }, [active.id]);

  const f0 = useScenario(scns[0], horizon);
  const f1 = useScenario(scns[1], horizon);
  const f2 = useScenario(scns[2], horizon);
  const f3 = useScenario(scns[3], horizon);
  const results = [f0, f1, f2, f3].slice(0, scns.length);
  const base = ws.settings.baseCurrency;
  const real = ws.settings.realTerms;
  const startYear = Number(todayISO().slice(0, 4));
  const loading = results.some((r) => r.loading || !r.res);

  const set = (id: string, p: Partial<Scn>) => setScns((list) => list.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const add = () => {
    if (scns.length >= 4) return;
    const used = new Set(scns.map((s) => s.slot));
    const slot = [0, 1, 2, 3].find((x) => !used.has(x)) ?? scns.length;
    setScns((l) => [...l, { id: uid('sc'), slot, name: 'Rupee crisis test', sip: active.plan.sipMonthly, stepUp: active.plan.sipStepUp, mix: 'current', rebalance: false, shock: 'deval' }]);
  };

  const chart = useMemo(() => {
    const ready = results.map((r) => r.res);
    const first = ready.find(Boolean);
    if (!first) return null;
    const labels = first.points.map((mm) => String(startYear + Math.round(mm / 12)));
    const series = scns.map((s, i) => {
      const res = ready[i];
      const data = res ? forecastSeries(res, base, real)[3] : labels.map(() => null);
      return { name: s.name, data: data.slice(0, labels.length) as (number | null)[], color: colors.series[s.slot] };
    });
    return { labels, series };
  }, [f0.res, f1.res, f2.res, f3.res, scns, base, real, colors, startYear]);

  const rows = useMemo(() => {
    const H = (r: ForecastState) => (r.res ? r.res.points.length - 1 : 0);
    const val = (r: ForecastState, p: number) => (r.res ? forecastSeries(r.res, base, real)[p][H(r)] : NaN);
    const out: { label: string; values: string[]; best?: number }[] = [
      { label: `Median${real ? ", today's money" : ''}`, values: results.map((r) => (r.res ? fmt.base$(val(r, 3)) : '…')) },
      { label: 'Pessimistic (P10)', values: results.map((r) => (r.res ? fmt.base$(val(r, 1)) : '…')) },
      { label: 'Optimistic (P90)', values: results.map((r) => (r.res ? fmt.base$(val(r, 5)) : '…')) },
      { label: 'Growth rate, median', values: results.map((r) => (r.res ? fmt.pct(r.res.twrCagrPct[1], 1) : '…')) },
      { label: 'Beats inflation', values: results.map((r) => (r.res ? fmt.pct(r.res.realTwrPositive * 100, 0) : '…')) },
      { label: 'Loss in the first year', values: results.map((r) => (r.res && isFinite(r.res.probLoss1y) ? fmt.pct(r.res.probLoss1y * 100, 0) : '–')) },
      { label: 'Typical worst fall', values: results.map((r) => (r.res ? fmt.pct(-r.res.maxDD.median * 100, 0) : '…')) },
      { label: 'Money put in', values: results.map((r) => (r.res ? fmt.money(r.res.contribCum[H(r)]) : '…')) },
    ];
    for (const g of active.goals) {
      out.push({ label: `Goal: ${g.name}`, values: results.map((r) => { const x = r.res?.goals.find((y) => y.id === g.id); return x ? fmt.pct(x.prob * 100, 0) : r.res ? '–' : '…'; }) });
    }
    return out;
  }, [f0.res, f1.res, f2.res, f3.res, base, real, fmt, active.goals, scns.length]);

  const explain = () => {
    const lines = rows.map((r) => `${r.label}: ${scns.map((s, i) => `${s.name} ${r.values[i]}`).join('; ')}`).join('\n');
    askAI(`Compare these plans for me and say which one you would pick for my situation and why, in under 250 words. Mention the trade-off between growth and risk.\n${scns.map((s) => `${s.name}: SIP ${fmt.money(s.sip)}/month rising ${s.stepUp}%/yr; mix ${s.mix}; rebalancing ${s.rebalance ? 'yearly' : 'none'}; ${s.shock ? `starts with the "${STRESS_PRESETS.find((p) => p.key === s.shock)?.name}" shock` : 'no shock'}`).join('\n')}\nResults over ${horizon} years (${real ? "today's money" : 'nominal'}, ${base}):\n${lines}`, true, 'Compare my plans');
  };

  const mixOptions = [
    { value: 'current' as MixChoice, label: 'Today’s mix' },
    ...(active.targetMix ? [{ value: 'target' as MixChoice, label: 'My target mix' }] : []),
    ...PROFILE_ORDER.map((p) => ({ value: p as MixChoice, label: `${PROFILE_LABELS[p]} model` })),
  ];

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Compare plans"
        sub="Up to four plans side by side, on the same simulated markets (same seed), so differences come from your choices, not luck."
        actions={<>
          <Button icon="plus" onClick={add} disabled={scns.length >= 4}>Add plan</Button>
          <Button variant="ai" icon="sparkle" onClick={explain} disabled={loading}>Which plan is better?</Button>
        </>}
      />
      <ExampleBanner />
      <Card>
        <div className="row" style={{ gap: 16 }}>
          <div style={{ minWidth: 260, flex: 1 }}><Slider label="Horizon for all plans" value={horizon} min={1} max={40} step={1} onChange={setHorizon} display={`${horizon} years`} /></div>
          <span className="small muted">{Math.min(active.plan.paths, 2000).toLocaleString()} paths per plan · whole portfolio (filters do not apply here)</span>
          {loading && <span className="row small muted"><Spinner /> Simulating…</span>}
        </div>
      </Card>
      <div className="grid">
        {scns.map((s) => (
          <section key={s.id} className={'card ' + (scns.length >= 4 ? 'span-3' : scns.length === 3 ? 'span-4' : 'span-6')} style={{ borderTop: `3px solid ${colors.series[s.slot]}` }}>
            <div className="card-b stack" style={{ paddingTop: 12, gap: 10 }}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <span className="swatch" style={{ background: colors.series[s.slot], width: 12, height: 12 }} />
                <input className="input" aria-label="Plan name" value={s.name} maxLength={40} onChange={(e) => set(s.id, { name: e.target.value })} style={{ fontWeight: 600 }} />
                {scns.length > 1 && <Button size="sm" variant="ghost" iconOnly icon="close" onClick={() => setScns((l) => l.filter((x) => x.id !== s.id))}>Remove {s.name}</Button>}
              </div>
              <Field label="Monthly investment" htmlFor={`sip-${s.id}`}><NumberInput id={`sip-${s.id}`} value={s.sip} onChange={(v) => set(s.id, { sip: Math.max(0, v ?? 0) })} prefix="Rs" groupStyle="lakh" step={5000} /></Field>
              <Slider label="Yearly increase" value={s.stepUp} min={0} max={20} step={1} onChange={(v) => set(s.id, { stepUp: v })} display={`${s.stepUp}%`} />
              <Field label="Mix" htmlFor={`mix-${s.id}`}><Select id={`mix-${s.id}`} value={s.mix} onChange={(v) => set(s.id, { mix: v })} options={mixOptions} /></Field>
              <Toggle checked={s.rebalance} onChange={(b) => set(s.id, { rebalance: b })} label={s.mix === 'current' ? 'Rebalance yearly to today’s weights' : 'Move liquid assets to this mix and rebalance yearly'} />
              <Field label="Start with a market shock" htmlFor={`shock-${s.id}`}><Select id={`shock-${s.id}`} value={s.shock} onChange={(v) => set(s.id, { shock: v })} options={[{ value: '', label: 'None' }, ...STRESS_PRESETS.map((p) => ({ value: p.key, label: p.name }))]} /></Field>
            </div>
          </section>
        ))}
      </div>
      <Card className="chart-card" title="Median net worth by plan" sub={`${real ? "Today's money" : 'Nominal'} · ${base} · each line is the middle outcome of its plan`}>
        {chart ? (
          <ChartFrame
            legend={scns.map((s) => <LegendItem key={s.id} kind="line" color={colors.series[s.slot]} label={s.name} />)}
            chart={<MultiLineChart labels={chart.labels} series={chart.series} fmtVal={fmt.baseC} fmtAxis={fmt.axis} height={340} ariaLabel="Median net worth for each plan" />}
            table={() => (
              <table className="t compact"><thead><tr><th>Year</th>{chart.series.map((s) => <th key={s.name} className="num">{s.name}</th>)}</tr></thead>
                <tbody>{chart.labels.map((l, i) => <tr key={l + i}><td>{l}</td>{chart.series.map((s) => <td key={s.name} className="num">{s.data[i] === null ? '…' : fmt.base$(s.data[i] as number)}</td>)}</tr>)}</tbody>
              </table>
            )}
          />
        ) : (
          <div style={{ height: 340, display: 'grid', placeItems: 'center' }} className="muted small">Simulating plans…</div>
        )}
      </Card>
      <Card flush title={chart ? `Results in ${chart.labels[chart.labels.length - 1]}` : `Results after ${horizon} years`} sub={`Same markets for every plan; goal odds use each plan’s savings${chart && chart.labels.length - 1 > horizon ? '. The period runs past your horizon to cover every goal.' : ''}`}>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Measure</th>{scns.map((s) => <th key={s.id} className="num"><span className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}><span className="swatch" style={{ background: colors.series[s.slot] }} />{s.name}</span></th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}><td>{r.label}</td>{r.values.map((v, i) => <td key={i} className="num">{v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mini-help">A shock is applied to today’s values before the simulation starts, so that plan shows the path after a crash at the outset. Model mixes apply to liquid holdings; property and locked assets stay as they are.</p>
    </div>
  );
}
