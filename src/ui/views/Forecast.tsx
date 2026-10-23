import React, { useMemo, useState } from 'react';
import { CLASS_META } from '../../engine/catalog';
import { addMonthsISO, monthsBetween, todayISO, uid } from '../../engine/format';
import { logHistogram } from '../../engine/risk';
import { defaultPlan } from '../../engine/samples';
import type { SimResult } from '../../engine/simtypes';
import type { PlanSettings } from '../../engine/types';
import { CLASS_ORDER } from '../../engine/types';
import { useForecast } from '../../state/analytics';
import { useUI, useWS } from '../../state/store';
import { ChartFrame, LegendItem, alpha, classColor, useColors } from '../charts/base';
import { BandLineChart, FanChart, Histogram, StackedBars, Waterfall } from '../charts/charts';
import { Button, Callout, Card, Field, NumberInput, Select, Seg, Slider, Stat, Tabs, Toggle } from '../components/primitives';
import { useFmt } from '../fmt';
import { ExampleBanner, PageHead } from './common';
import { forecastSeries } from './Overview';

type Tab = 'table' | 'dist' | 'waterfall' | 'classes' | 'macro';

/** Converts a PKR nominal aggregate at yearly point k into the current view (base currency, real or nominal),
 *  using the median CPI and USD/PKR paths. Exact for PKR nominal; an approximation otherwise. */
export function makeConverter(res: SimResult, base: 'PKR' | 'USD', real: boolean, usInflation: number) {
  const usDefl = (k: number) => Math.pow(1 + usInflation / 100, res.points[k] / 12);
  return (pkrNominal: number, k: number) => {
    if (base === 'USD') return real ? pkrNominal / res.fxPct[3][k] / usDefl(k) : pkrNominal / res.fxPct[3][k];
    return real ? pkrNominal / res.cpiPct[3][k] : pkrNominal;
  };
}

export function PlanControls({ plan, setPlan, hasTarget, compact }: { plan: PlanSettings; setPlan: (p: Partial<PlanSettings>) => void; hasTarget: boolean; compact?: boolean }) {
  const today = todayISO();
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Slider label="Horizon" value={plan.horizonYears} min={1} max={40} step={1} onChange={(v) => setPlan({ horizonYears: v })} display={`${plan.horizonYears} years (to ${Number(today.slice(0, 4)) + plan.horizonYears})`} />
      <Field label="Monthly investment (SIP)" htmlFor="f-sip">
        <NumberInput id="f-sip" value={plan.sipMonthly} onChange={(v) => setPlan({ sipMonthly: Math.max(0, v ?? 0) })} prefix="Rs" groupStyle="lakh" step={5000} />
      </Field>
      <Slider label="Yearly SIP increase" value={plan.sipStepUp} min={0} max={20} step={1} onChange={(v) => setPlan({ sipStepUp: v })} display={`${plan.sipStepUp}%`} />
      <Field label="New money goes into" htmlFor="f-mix" hint={!hasTarget ? 'Set a target mix in the Optimizer to use it here' : undefined}>
        <Select id="f-mix" value={plan.contributionMix} onChange={(v) => setPlan({ contributionMix: v })} options={[{ value: 'current', label: 'Today’s liquid mix' }, ...(hasTarget ? [{ value: 'target' as const, label: 'My target mix' }] : [])]} />
      </Field>
      <Field label="Rebalancing" htmlFor="f-reb">
        <Select id="f-reb" value={plan.rebalance} onChange={(v) => setPlan({ rebalance: v })} options={[{ value: 'none', label: 'None: let holdings drift' }, { value: 'annual_current', label: 'Yearly, back to today’s weights' }, ...(hasTarget ? [{ value: 'annual_target' as const, label: 'Yearly, to my target mix' }] : [])]} />
      </Field>
      <div className="stack" style={{ gap: 8 }}>
        <Toggle checked={plan.reinvestIncome} onChange={(b) => setPlan({ reinvestIncome: b })} label="Reinvest dividends, profit and rent" />
        <Toggle checked={plan.applyTax} onChange={(b) => setPlan({ applyTax: b })} label="Deduct tax on income" />
        <Toggle checked={plan.applyZakat} onChange={(b) => setPlan({ applyZakat: b })} label="Deduct zakat each year" />
      </div>
      {!compact && (
        <>
          <div className="divider" />
          <div className="stack" style={{ gap: 8 }}>
            <div className="row-between"><span className="small strong">One-off investments</span><Button size="sm" variant="ghost" icon="plus" onClick={() => setPlan({ lumpSums: [...plan.lumpSums, { id: uid('ls'), date: addMonthsISO(today, 12), amount: 1_000_000, label: 'Bonus' }] })}>Add</Button></div>
            {plan.lumpSums.map((l, i) => (
              <div key={l.id} className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="date" className="input" aria-label="Date of investment" style={{ width: 150, flex: 'none' }} value={l.date} onChange={(e) => setPlan({ lumpSums: plan.lumpSums.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
                <NumberInput ariaLabel="Amount" value={l.amount} onChange={(v) => setPlan({ lumpSums: plan.lumpSums.map((x, j) => (j === i ? { ...x, amount: v ?? 0 } : x)) })} groupStyle="lakh" />
                <Button size="sm" variant="ghost" iconOnly icon="trash" onClick={() => setPlan({ lumpSums: plan.lumpSums.filter((_, j) => j !== i) })}>Remove investment</Button>
              </div>
            ))}
            {!plan.lumpSums.length && <span className="tiny muted">Bonuses, an inheritance or a property sale you expect.</span>}
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row-between"><span className="small strong">Regular withdrawals</span><Button size="sm" variant="ghost" icon="plus" onClick={() => setPlan({ withdrawals: [...plan.withdrawals, { id: uid('wd'), start: addMonthsISO(today, 12), monthly: 50_000, indexed: true, label: 'Living costs' }] })}>Add</Button></div>
            {plan.withdrawals.map((w, i) => (
              <div key={w.id} className="stack" style={{ gap: 6, padding: 8, border: '1px solid var(--line)', borderRadius: 8 }}>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <NumberInput ariaLabel="Monthly amount" value={w.monthly} onChange={(v) => setPlan({ withdrawals: plan.withdrawals.map((x, j) => (j === i ? { ...x, monthly: v ?? 0 } : x)) })} prefix="Rs/mo" groupStyle="lakh" />
                  <Button size="sm" variant="ghost" iconOnly icon="trash" onClick={() => setPlan({ withdrawals: plan.withdrawals.filter((_, j) => j !== i) })}>Remove withdrawal</Button>
                </div>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input type="date" className="input" aria-label="Withdrawals start" value={w.start} onChange={(e) => setPlan({ withdrawals: plan.withdrawals.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
                  <input type="date" className="input" aria-label="Withdrawals end (optional)" value={w.end ?? ''} onChange={(e) => setPlan({ withdrawals: plan.withdrawals.map((x, j) => (j === i ? { ...x, end: e.target.value || undefined } : x)) })} />
                </div>
                <Toggle checked={w.indexed} onChange={(b) => setPlan({ withdrawals: plan.withdrawals.map((x, j) => (j === i ? { ...x, indexed: b } : x)) })} label="Rise with inflation" />
              </div>
            ))}
            {!plan.withdrawals.length && <span className="tiny muted">Monthly spending taken from liquid assets.</span>}
          </div>
          <div className="divider" />
          <div className="row-between">
            <span className="small strong">Simulated paths</span>
            <Seg size="sm" label="Simulated paths" value={String(plan.paths) as '1000' | '2000' | '5000' | '10000'} onChange={(v) => setPlan({ paths: Number(v) })} options={[{ value: '1000', label: '1k' }, { value: '2000', label: '2k' }, { value: '5000', label: '5k' }, { value: '10000', label: '10k' }]} />
          </div>
          <div className="row-between">
            <span className="small muted">Random seed {plan.seed}</span>
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => setPlan({ seed: Math.floor(Math.random() * 1e6) })}>New draw</Button>
          </div>
          <span className="tiny muted">The same seed gives the same results, so changes can be compared fairly.</span>
        </>
      )}
    </div>
  );
}

export function Forecast() {
  const { ws, active, updatePortfolio } = useWS();
  const { askAI, go } = useUI();
  const fmt = useFmt();
  const colors = useColors();
  const [tab, setTab] = useState<Tab>('table');
  const [showPaths, setShowPaths] = useState(false);
  const plan = active.plan;
  const setPlan = (p: Partial<PlanSettings>) => updatePortfolio((x) => ({ ...x, plan: { ...x.plan, ...p } }));
  const fc = useForecast({ samplePaths: showPaths ? 12 : 0 });
  const res = fc.res;
  const base = ws.settings.baseCurrency;
  const real = ws.settings.realTerms;
  const usInfl = ws.assumptions.macro.usInflation;
  const startYear = Number(todayISO().slice(0, 4));

  const view = useMemo(() => {
    if (!res) return null;
    const series = forecastSeries(res, base, real);
    const labels = res.points.map((m) => String(startYear + Math.round(m / 12)));
    const H = res.points.length - 1;
    const conv = makeConverter(res, base, real, usInfl);
    const today = todayISO();
    const goals = res.goals
      .map((g) => {
        const goal = active.goals.find((x) => x.id === g.id);
        if (!goal) return null;
        const mth = monthsBetween(today, goal.date);
        const k = Math.min(H, Math.max(0, Math.round(mth / 12)));
        return { index: k, value: conv(g.targetNominal, k), name: goal.name, prob: g.prob };
      })
      .filter((x): x is { index: number; value: number; name: string; prob: number } => !!x);
    const contrib = base === 'PKR' && !real ? res.contribCum.map((c) => series[3][0] + c) : undefined;
    const sample = res.samples.length ? res.samples.map((row) => row.map((v, k) => conv(v, k))) : undefined;
    const realSeries = base === 'USD' ? res.usdReal : res.real;
    return { series, labels, H, goals, contrib, conv, sample, realSeries };
  }, [res, base, real, usInfl, active.goals, startYear]);

  const dist = useMemo(() => {
    if (!res || !view) return null;
    const H = view.H;
    const pkrReal = real && base === 'PKR';
    const src = pkrReal ? res.terminalReal : res.terminalNominal;
    const data = Array.from(src, (v) => (pkrReal ? v : view.conv(v, H)));
    const h = logHistogram(data, 36);
    const sorted = [...data].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
    return { h, markers: [{ value: q(0.1), label: 'P10' }, { value: q(0.5), label: 'Median' }, { value: q(0.9), label: 'P90' }] };
  }, [res, view, real, base]);

  const water = useMemo(() => {
    if (!res || !view || !fc.built) return null;
    const H = view.H;
    const start = res.nominal[3][0];
    const contrib = res.contribCum[H];
    const withdrawn = res.withdrawCum[H];
    const tax = res.taxMedian.reduce((a, b) => a + b, 0);
    const zakat = res.zakatMedian.reduce((a, b) => a + b, 0);
    const end = res.nominal[3][H];
    const growth = end - start - contrib + withdrawn;
    const assets = fc.built.input.assets.filter((a) => !a.synthetic);
    const v0 = assets.reduce((s, a) => s + a.value0, 0);
    const cost0 = assets.reduce((s, a) => s + a.cost0, 0);
    const wRate = v0 > 0 ? assets.reduce((s, a) => s + a.value0 * a.cgtRate, 0) / v0 : 0;
    const liabEnd = fc.built.input.plan.liabilities[res.points[H]] ?? 0;
    const gain = Math.max(0, end + liabEnd - (cost0 + contrib - withdrawn));
    const cgt = gain * wRate;
    const steps = [
      { label: 'Today', value: start, total: true },
      { label: 'Money put in', value: contrib },
      ...(withdrawn > 0 ? [{ label: 'Withdrawals and goals', value: -withdrawn }] : []),
      { label: 'Growth after income tax', value: growth },
      { label: `Median ${view.labels[H]}`, value: end, total: true },
      ...(cgt > 0 ? [{ label: 'CGT if all sold (est.)', value: -cgt }, { label: 'After CGT', value: end - cgt, total: true }] : []),
    ];
    return { steps, tax, zakat, cgt, wRate };
  }, [res, view, fc.built]);

  const classes = useMemo(() => {
    if (!res || !view) return null;
    const present = CLASS_ORDER.map((c, i) => ({ c, i })).filter(({ i }) => res.classCentral[i].some((v) => v > 1));
    const step = Math.max(1, Math.ceil(view.labels.length / 14));
    const idx = view.labels.map((_, k) => k).filter((k) => k % step === 0 || k === view.H);
    return {
      present,
      labels: idx.map((k) => view.labels[k]),
      series: present.map(({ c, i }) => ({ name: CLASS_META[c].label, color: classColor(colors, CLASS_META[c].slot), data: idx.map((k) => view.conv(res.classCentral[i][k], k)) })),
    };
  }, [res, view, colors]);

  const macro = useMemo(() => {
    if (!res) return null;
    const infl = res.cpiPct.map((row) => row.map((v, k) => (k === 0 ? ws.assumptions.macro.cpi0 : (Math.pow(v, 12 / res.points[k]) - 1) * 100)));
    const rate = res.ratePct.map((row) => row.map((v) => v * 100));
    return { infl, rate };
  }, [res, ws.assumptions.macro.cpi0]);

  const cpiCagr = res ? Math.pow(res.cpiPct[3][res.points.length - 1], 12 / res.months) - 1 : 0;
  const extended = res ? res.months > plan.horizonYears * 12 : false;

  const explain = () => {
    if (!res || !view) return;
    const H = view.H;
    askAI(
      `Explain my forecast in plain words for a non-expert, then give two practical ways to improve it. Results (${real ? "today's money" : 'nominal'}, ${base}): start ${fmt.base$(view.series[3][0])}; in ${view.labels[H]} the median is ${fmt.base$(view.series[3][H])}, P10 ${fmt.base$(view.series[1][H])}, P90 ${fmt.base$(view.series[5][H])}; median time-weighted return ${res.twrCagrPct[1].toFixed(1)}% a year (P10 ${res.twrCagrPct[0].toFixed(1)}%, P90 ${res.twrCagrPct[2].toFixed(1)}%); chance of beating inflation ${(res.realTwrPositive * 100).toFixed(0)}%; typical worst fall ${(res.maxDD.median * 100).toFixed(0)}%. Goals: ${res.goals.map((g) => `${active.goals.find((x) => x.id === g.id)?.name} ${(g.prob * 100).toFixed(0)}%`).join(', ') || 'none'}. You may call run_forecast to test an improvement.`,
      true,
      'Explain my forecast',
    );
  };

  if (!active.holdings.length) {
    return (
      <div className="stack">
        <PageHead title="Forecast" sub="The forecast starts from what you own today." />
        <Callout>Your portfolio is empty. Add holdings on the Holdings screen, or load an example from the portfolio menu.</Callout>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Forecast"
        sub={`Monte Carlo projection of ${active.name}, with Pakistan’s short rate, inflation and the rupee moving together. ${plan.paths.toLocaleString()} paths, monthly steps.`}
        actions={<>
          <Button icon="refresh" onClick={() => setPlan({ ...defaultPlan({ sipMonthly: plan.sipMonthly, horizonYears: plan.horizonYears, retirement: plan.retirement }) })}>Reset options</Button>
          <Button variant="ai" icon="sparkle" onClick={explain} disabled={!res}>Explain with AI</Button>
        </>}
      />
      <ExampleBanner />
      <div className="split">
        <Card className="sticky-panel" title="Plan" sub="Every change reruns the simulation">
          <PlanControls plan={plan} setPlan={setPlan} hasTarget={!!active.targetMix} />
        </Card>
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          {!res || !view ? (
            <Card><div style={{ height: 420, display: 'grid', placeItems: 'center' }} className="muted small">{fc.error ? `Forecast failed: ${fc.error}` : 'Simulating…'}</div></Card>
          ) : (
            <>
              <div className="stats">
                <Stat label={`Median in ${view.labels[view.H]}`} value={fmt.base$(view.series[3][view.H])} note={real ? "in today's money" : `≈ ${fmt.base$(view.realSeries[3][view.H])} in today's money`} />
                <Stat label="Pessimistic (P10)" value={fmt.base$(view.series[1][view.H])} note="1 in 10 paths end lower" />
                <Stat label="Optimistic (P90)" value={fmt.base$(view.series[5][view.H])} note="1 in 10 paths end higher" />
                <Stat label="Growth rate" value={fmt.pct(res.twrCagrPct[1], 1)} note={`a year, median · inflation ≈ ${fmt.pct(cpiCagr * 100, 1)}`} title="Median time-weighted return" />
                <Stat label="Beats inflation" value={fmt.pct(res.realTwrPositive * 100, 0)} note="of paths, over the whole period" />
                <Stat label="Typical worst fall" value={fmt.pct(-res.maxDD.median * 100, 0)} note={`1 in 10 paths fall ${fmt.pct(res.maxDD.p90 * 100, 0)} or more`} title="Median of each path's largest peak-to-trough fall" />
              </div>
              <Card className="chart-card" title="Net worth range over time" sub={`${real ? "Today's money" : 'Nominal'} · ${base}${view.goals.length ? ' · goal targets shown as diamonds' : ''}`}
                actions={<Toggle checked={showPaths} onChange={setShowPaths} label="Show sample paths" />}>
                <ChartFrame
                  legend={<>
                    <LegendItem kind="line" color={colors.series[0]} label="Median" />
                    <LegendItem color={alpha(colors.series[0], 0.45)} label="P25 to P75" />
                    <LegendItem color={alpha(colors.series[0], 0.2)} label="P10 to P90" />
                    {view.contrib && <LegendItem kind="line" color={colors.other} label="Money put in" />}
                    {view.sample && <LegendItem kind="line" color={alpha(colors.ink3, 0.5)} label="Sample paths" />}
                    {view.goals.length > 0 && <LegendItem color={colors.ink} label="Goal target" />}
                  </>}
                  chart={<FanChart labels={view.labels} pct={view.series} contrib={view.contrib} goals={view.goals} sample={view.sample} fmtVal={fmt.base$} fmtAxis={fmt.axis} height={380} dim={fc.loading} ariaLabel="Forecast fan chart of net worth" />}
                  table={() => <OutcomeTable labels={view.labels} series={view.series} />}
                  note={extended ? `The chart runs to ${view.labels[view.H]} to cover goals${plan.retirement.enabled ? ' and retirement' : ''} beyond your ${plan.horizonYears}-year horizon.` : undefined}
                />
              </Card>
              <Card>
                <Tabs value={tab} onChange={setTab} label="Forecast details" options={[{ value: 'table', label: 'Outcomes by year' }, { value: 'dist', label: 'Final distribution' }, { value: 'waterfall', label: 'Saving vs growth' }, { value: 'classes', label: 'By asset class' }, { value: 'macro', label: 'Rates, inflation, rupee' }]} />
                <div style={{ paddingTop: 14 }}>
                  {tab === 'table' && <OutcomeTable labels={view.labels} series={view.series} full res={res} />}
                  {tab === 'dist' && dist && (
                    <ChartFrame
                      chart={<Histogram edges={dist.h.edges} counts={dist.h.counts} fmtVal={fmt.base$} markers={dist.markers} height={280} ariaLabel="Distribution of final net worth" />}
                      table={() => (
                        <table className="t compact"><thead><tr><th>Range</th><th className="num">Share of paths</th></tr></thead>
                          <tbody>{dist.h.counts.map((c, i) => <tr key={i}><td>{fmt.base$(dist.h.edges[i])} to {fmt.base$(dist.h.edges[i + 1])}</td><td className="num">{((c / (res.paths || 1)) * 100).toFixed(1)}%</td></tr>)}</tbody>
                        </table>
                      )}
                      note={`Share of the ${res.paths.toLocaleString()} simulated paths ending in each range in ${view.labels[view.H]}. Ranges widen to the right (a log scale) because compounding stretches good outcomes much further than bad ones.${base === 'USD' ? ' USD values convert each path at the median exchange rate.' : ''}`}
                    />
                  )}
                  {tab === 'waterfall' && water && (
                    <div className="stack">
                      <ChartFrame
                        chart={<Waterfall steps={water.steps} fmtVal={fmt.pkrC} fmtAxis={fmt.axisPkr} height={300} ariaLabel="Where the median outcome comes from" />}
                        table={() => (
                          <table className="t compact"><tbody>{water.steps.map((s) => <tr key={s.label}><td>{s.label}</td><td className="num">{fmt.pkr(s.value)}</td></tr>)}</tbody></table>
                        )}
                      />
                      <p className="mini-help">Nominal rupees on the median path. Tax on income ({fmt.pkr(water.tax)}) and zakat ({fmt.pkr(water.zakat)}) over the period are already netted out of growth. The CGT step estimates the tax if everything were sold at the end, at your holdings’ average capital gains rate of {fmt.pct(water.wRate * 100, 1)}.</p>
                    </div>
                  )}
                  {tab === 'classes' && classes && (
                    <ChartFrame
                      legend={classes.present.map(({ c }) => <LegendItem key={c} color={classColor(colors, CLASS_META[c].slot)} label={CLASS_META[c].label} />)}
                      chart={<StackedBars labels={classes.labels} series={classes.series} fmtVal={fmt.base$} fmtAxis={fmt.axis} height={300} ariaLabel="Projected composition by asset class" />}
                      table={() => (
                        <table className="t compact"><thead><tr><th>Year</th>{classes.series.map((s) => <th key={s.name} className="num">{s.name}</th>)}</tr></thead>
                          <tbody>{classes.labels.map((l, i) => <tr key={l}><td>{l}</td>{classes.series.map((s) => <td key={s.name} className="num">{fmt.base$(s.data[i])}</td>)}</tr>)}</tbody>
                        </table>
                      )}
                      note="Average composition of the paths that end near the median. New money follows your contribution mix."
                    />
                  )}
                  {tab === 'macro' && macro && (
                    <div className="grid">
                      <div className="span-4 stack" style={{ gap: 4 }}>
                        <div className="small strong">USD/PKR</div>
                        <BandLineChart labels={view.labels} median={res.fxPct[3]} low={res.fxPct[1]} high={res.fxPct[5]} name="USD/PKR" fmtVal={fmtRs} fmtAxis={fmtAxN} height={200} ariaLabel="USD/PKR paths" />
                      </div>
                      <div className="span-4 stack" style={{ gap: 4 }}>
                        <div className="small strong">PKR short rate</div>
                        <BandLineChart labels={view.labels} median={macro.rate[3]} low={macro.rate[1]} high={macro.rate[5]} name="Short rate" color={colors.series[1]} fmtVal={fmtP} fmtAxis={fmtAxP} height={200} ariaLabel="Short rate paths" yMin={0} />
                      </div>
                      <div className="span-4 stack" style={{ gap: 4 }}>
                        <div className="small strong">Average inflation since today</div>
                        <BandLineChart labels={view.labels} median={macro.infl[3]} low={macro.infl[1]} high={macro.infl[5]} name="Inflation" color={colors.series[2]} fmtVal={fmtP} fmtAxis={fmtAxP} height={200} ariaLabel="Inflation paths" yMin={0} />
                      </div>
                      <p className="mini-help span-12">Median with the P10 to P90 range. Devaluation jumps push the rupee, rates and inflation up together, which is why rupee-only portfolios lose real value in bad paths.</p>
                    </div>
                  )}
                </div>
              </Card>
              {res.shortfallProb > 0.02 && (
                <Callout tone="warn">In {fmt.pct(res.shortfallProb * 100, 0)} of paths, liquid assets ran out before a withdrawal or goal was fully paid. <button type="button" className="linkbtn" onClick={() => go('goals')}>Review goals</button></Callout>
              )}
              <p className="mini-help">Values come from {res.paths.toLocaleString()} simulated paths of monthly returns for PSX, global stocks, bonds, gold, property and crypto, correlated with Pakistan’s short rate, CPI and USD/PKR, including rare devaluation jumps. Assumptions are on the Markets screen. Ran in {Math.round(res.elapsedMs)} ms.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const fmtRs = (v: number) => `Rs ${v.toFixed(0)}`;
const fmtP = (v: number) => `${v.toFixed(1)}%`;
const fmtAxP = (v: number) => `${v}%`;
const fmtAxN = (v: number) => `${Math.round(v)}`;

export function OutcomeTable({ labels, series, full, res }: { labels: string[]; series: number[][]; full?: boolean; res?: SimResult }) {
  const fmt = useFmt();
  const { ws } = useWS();
  const H = labels.length - 1;
  const rows = full ? Array.from(new Set([1, 3, 5, 10, 15, 20, 25, 30, 35, 40].filter((y) => y < H).concat([H]))) : labels.map((_, i) => i);
  const usdBase = ws.settings.baseCurrency === 'USD';
  const realView = ws.settings.realTerms;
  return (
    <div className="table-wrap">
      <table className="t compact">
        <thead>
          <tr><th>Year</th><th className="num">P10</th>{!full && <th className="num">P25</th>}<th className="num">Median</th>{!full && <th className="num">P75</th>}<th className="num">P90</th>{full && res && <th className="num">{realView ? 'Median, nominal' : 'Median, today’s money'}</th>}{full && res && !usdBase && <th className="num">Median in USD</th>}</tr>
        </thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k}>
              <td>{labels[k]}</td>
              <td className="num">{fmt.base$(series[1][k])}</td>
              {!full && <td className="num">{fmt.base$(series[2][k])}</td>}
              <td className="num strong">{fmt.base$(series[3][k])}</td>
              {!full && <td className="num">{fmt.base$(series[4][k])}</td>}
              <td className="num">{fmt.base$(series[5][k])}</td>
              {full && res && <td className="num">{usdBase ? fmt.usd((realView ? res.usd : res.usdReal)[3][k]) : fmt.pkr((realView ? res.nominal : res.real)[3][k])}</td>}
              {full && res && !usdBase && <td className="num">{fmt.usd(res.usd[3][k])}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
