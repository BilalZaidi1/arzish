import React, { useEffect, useMemo, useState } from 'react';
import { todayISO } from '../../engine/format';
import {
  currentMix, efficientFrontier, MODEL_PORTFOLIOS, optimizeForVol, OPT_HOWTO, OPT_LABELS, portStats, PROFILE_LABELS, PROFILE_ORDER,
  profileFromScore, rebalanceTrades, RISK_QUESTIONS,
} from '../../engine/optimize';
import type { OptClass, RiskProfile } from '../../engine/types';
import { OPT_CLASSES } from '../../engine/types';
import { useClassStats } from '../../state/analytics';
import { useFilteredHoldings, useUI, useWS } from '../../state/store';
import { ChartFrame, LegendItem, useColors } from '../charts/base';
import { FrontierChart, PairedBars } from '../charts/charts';
import { Button, Callout, Card, Empty, Field, Pill, Select, Slider, Spinner, Stat, Toggle } from '../components/primitives';
import { useFmt } from '../fmt';
import { ExampleBanner, PageHead } from './common';

type Basis = 'samerisk' | 'maxsharpe' | 'minvol' | RiskProfile;

/** Color slot for each optimizer class, matching the asset-class palette where one exists. */
export function optColor(series: string[], c: OptClass): string {
  const slot: Record<OptClass, number> = { pkfi: 2, psx: 0, gleq: 5, gold: 3, usd: 7, crypto: 6 };
  return series[slot[c]];
}

const fmtPctA = (v: number) => `${Math.round(v)}%`;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [key, ms]);
  return v;
}

export function Optimizer() {
  const { ws, active, update, updatePortfolio } = useWS();
  const { askAI, go, toast, openEditor } = useUI();
  const holdings = useFilteredHoldings();
  const fmt = useFmt();
  const colors = useColors();
  const cs = useClassStats();
  const stats = cs.stats;
  const [shariah, setShariah] = useState(false);
  const [cryptoMax, setCryptoMax] = useState(5);
  const [minPkfi, setMinPkfi] = useState(5);
  const [maxSingle, setMaxSingle] = useState(60);
  const [basis, setBasis] = useState<Basis>(ws.settings.riskProfile ?? 'samerisk');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [quizOpen, setQuizOpen] = useState(!ws.settings.riskProfile);
  const rf = ws.market.tbill.m12 / 100;
  const today = todayISO();

  // Sliders update instantly; the optimisation (a few hundred ms) waits until they settle.
  const limits = useDebounced({ minPkfi, cryptoMax, maxSingle, shariah }, 220);
  const lb = useMemo(() => OPT_CLASSES.map((c) => (c === 'pkfi' ? limits.minPkfi / 100 : 0)), [limits.minPkfi]);
  const ub = useMemo(() => OPT_CLASSES.map((c) => (c === 'crypto' ? (limits.shariah ? 0 : limits.cryptoMax / 100) : limits.maxSingle / 100)), [limits.cryptoMax, limits.maxSingle, limits.shariah]);
  const fr = useMemo(() => (stats ? efficientFrontier(stats, lb, ub, rf) : null), [stats, lb, ub, rf]);
  const mix = useMemo(() => currentMix(holdings, ws.market), [holdings, ws.market]);

  const curStats = stats && mix.total > 0 ? portStats(mix.weights, stats) : null;
  const sameRisk = useMemo(() => {
    if (!stats || !curStats) return null;
    // The best return available without taking more risk than today.
    return optimizeForVol(stats, lb, ub, curStats.vol);
  }, [stats, lb, ub, curStats?.vol]);

  const recW = useMemo(() => {
    if (!fr) return null;
    if (basis === 'samerisk') return (sameRisk ?? fr.maxSharpe).w;
    if (basis === 'maxsharpe') return fr.maxSharpe.w;
    if (basis === 'minvol') return fr.minVol.w;
    const m = MODEL_PORTFOLIOS[basis];
    const w = OPT_CLASSES.map((c) => (shariah && c === 'crypto' ? 0 : m[c]));
    const s = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((x) => x / s);
  }, [fr, basis, shariah, sameRisk]);

  const recPct = useMemo(() => (recW ? (Object.fromEntries(OPT_CLASSES.map((c, i) => [c, Math.round(recW[i] * 1000) / 10])) as Record<OptClass, number>) : null), [recW]);
  const trades = useMemo(() => (recPct ? rebalanceTrades(holdings, mix, recPct, ws.market, ws.settings, today) : null), [holdings, mix, recPct, ws.market, ws.settings, today]);
  const cur = stats && mix.total > 0 ? portStats(mix.weights, stats) : null;
  const rec = stats && recW ? portStats(recW, stats) : null;
  const tgtW = active.targetMix ? (() => { const w = OPT_CLASSES.map((c) => active.targetMix![c] ?? 0); const s = w.reduce((a, b) => a + b, 0) || 1; return w.map((x) => x / s); })() : null;
  const tgt = stats && tgtW ? portStats(tgtW, stats) : null;

  const points = useMemo(() => {
    if (!stats || !fr) return [];
    const pts: { name: string; vol: number; ret: number; color: string; size?: number; strong?: boolean }[] = [];
    PROFILE_ORDER.forEach((p) => {
      const w = OPT_CLASSES.map((c) => MODEL_PORTFOLIOS[p][c] / 100);
      const s = portStats(w, stats);
      pts.push({ name: PROFILE_LABELS[p], vol: s.vol, ret: s.ret, color: basis === p ? colors.series[1] : colors.other, size: basis === p ? 13 : 9, strong: basis === p });
    });
    pts.push({ name: 'Max Sharpe', vol: fr.maxSharpe.vol, ret: fr.maxSharpe.ret, color: basis === 'maxsharpe' ? colors.series[1] : colors.series[0], size: basis === 'maxsharpe' ? 13 : 9, strong: basis === 'maxsharpe' });
    pts.push({ name: 'Lowest risk', vol: fr.minVol.vol, ret: fr.minVol.ret, color: basis === 'minvol' ? colors.series[1] : colors.series[0], size: basis === 'minvol' ? 13 : 9, strong: basis === 'minvol' });
    if (basis === 'samerisk' && sameRisk) pts.push({ name: 'Same risk, more return', vol: sameRisk.vol, ret: sameRisk.ret, color: colors.series[1], size: 13, strong: true });
    if (tgt) pts.push({ name: 'Your target', vol: tgt.vol, ret: tgt.ret, color: colors.series[2], size: 12, strong: true });
    if (cur) pts.push({ name: 'You today', vol: cur.vol, ret: cur.ret, color: colors.ink, size: 14, strong: true });
    return pts;
  }, [stats, fr, basis, colors, cur?.vol, cur?.ret, tgt?.vol, tgt?.ret, sameRisk]);

  const frontier = useMemo(() => (fr ? fr.points.map((p) => ({ vol: p.vol, ret: p.ret })) : []), [fr]);
  const drift = useMemo(() => (recW ? { labels: OPT_CLASSES.map((c) => OPT_LABELS[c]), a: mix.weights.map((w) => w * 100), b: recW.map((w) => w * 100) } : null), [recW, mix.weights]);

  const score = RISK_QUESTIONS.every((q) => answers[q.key] !== undefined) ? RISK_QUESTIONS.reduce((s, q) => s + (answers[q.key] ?? 0), 0) : null;
  const quizProfile = score !== null ? profileFromScore(score) : null;

  const setTarget = (thenForecast: boolean) => {
    if (!recPct) return;
    updatePortfolio((p) => ({ ...p, targetMix: recPct, plan: thenForecast ? { ...p.plan, contributionMix: 'target', rebalance: 'annual_target' } : p.plan }));
    toast(thenForecast ? 'Target mix set; forecast now invests and rebalances to it' : 'Saved as your target mix');
    if (thenForecast) go('forecast');
  };

  const explain = () => {
    if (!recW || !cur || !rec) return;
    askAI(
      `Explain the optimizer's suggestion in plain words and how I could implement it in Pakistan${shariah ? ' with Shariah-compliant products only' : ''}. Current mix of liquid assets: ${OPT_CLASSES.map((c, i) => `${OPT_LABELS[c]} ${(mix.weights[i] * 100).toFixed(0)}%`).join(', ')} (expected ${(cur.ret * 100).toFixed(1)}%, volatility ${(cur.vol * 100).toFixed(1)}%). Suggested (${basis === 'samerisk' ? 'the most return for my current level of risk' : basis === 'maxsharpe' ? 'maximum Sharpe within my limits' : basis === 'minvol' ? 'lowest risk' : `${PROFILE_LABELS[basis as RiskProfile]} model`}): ${OPT_CLASSES.map((c, i) => `${OPT_LABELS[c]} ${(recW[i] * 100).toFixed(0)}%`).join(', ')} (expected ${(rec.ret * 100).toFixed(1)}%, volatility ${(rec.vol * 100).toFixed(1)}%). Estimated CGT on sales ${fmt.money(trades?.totalTax ?? 0)}. Property and locked assets (${fmt.money(mix.locked)}) stay as they are. Point out what the model cannot see.`,
      true,
      'Explain the suggested mix',
    );
  };

  if (!holdings.length) {
    return (
      <div className="stack">
        <PageHead title="Optimizer" />
        <Card><Empty icon="optimizer" title="Nothing to optimise yet" action={<Button variant="primary" icon="plus" onClick={() => openEditor(null)}>Add holding</Button>}>Add holdings, or clear the filters, to compare your mix with the efficient frontier.</Empty></Card>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Optimizer"
        sub="Find a better mix of asset classes for the liquid part of your portfolio. Property and locked assets such as provident funds stay as they are."
        actions={<>
          <Button icon="check" onClick={() => setTarget(false)} disabled={!recPct}>Save as target mix</Button>
          <Button variant="primary" icon="forecast" onClick={() => setTarget(true)} disabled={!recPct}>Forecast with this mix</Button>
          <Button variant="ai" icon="sparkle" onClick={explain} disabled={!rec}>Explain with AI</Button>
        </>}
      />
      <ExampleBanner />
      <div className="split">
        <div className="stack split-side" style={{ gap: 16 }}>
          <Card title="Limits" sub="The optimizer stays within these">
            <div className="stack" style={{ gap: 14 }}>
              <Toggle checked={shariah} onChange={setShariah} label="Shariah-compliant products only" />
              <Slider label="Crypto, at most" value={shariah ? 0 : cryptoMax} min={0} max={20} step={1} onChange={setCryptoMax} display={shariah ? 'excluded' : `${cryptoMax}%`} />
              <Slider label="PKR fixed income, at least" value={minPkfi} min={0} max={50} step={1} onChange={setMinPkfi} display={`${minPkfi}%`} />
              <Slider label="Any one class, at most" value={maxSingle} min={30} max={100} step={5} onChange={setMaxSingle} display={`${maxSingle}%`} />
              <Field label="Suggest" htmlFor="opt-basis">
                <Select id="opt-basis" value={basis} onChange={setBasis} options={[
                  { value: 'samerisk', label: 'More return for today’s level of risk' },
                  { value: 'maxsharpe', label: 'Best return per unit of risk (max Sharpe)' },
                  { value: 'minvol', label: 'Lowest risk within my limits' },
                  ...PROFILE_ORDER.map((p) => ({ value: p as Basis, label: `${PROFILE_LABELS[p]} model portfolio${ws.settings.riskProfile === p ? ' (my profile)' : ''}` })),
                ]} />
              </Field>
              {basis !== 'maxsharpe' && basis !== 'minvol' && basis !== 'samerisk' && <span className="tiny muted">Model portfolios are fixed mixes; your limits do not change them{shariah ? ', except that crypto is removed' : ''}.</span>}
            </div>
          </Card>
          <Card title="Your risk profile" sub={ws.settings.riskProfile ? `Saved: ${PROFILE_LABELS[ws.settings.riskProfile]}` : 'Seven questions'}
            actions={<Button size="sm" variant="ghost" icon={quizOpen ? 'chevronDown' : 'chevronRight'} aria-expanded={quizOpen} onClick={() => setQuizOpen((o) => !o)}>{quizOpen ? 'Hide' : ws.settings.riskProfile ? 'Retake' : 'Start'}</Button>}>
            {!quizOpen ? (
              <p className="small ink2">{ws.settings.riskProfile ? `Your ${PROFILE_LABELS[ws.settings.riskProfile].toLowerCase()} profile picks the matching model portfolio in Suggest.` : 'Answer seven quick questions to find which model portfolio fits you.'}</p>
            ) : (
            <div className="stack" style={{ gap: 10 }}>
              {RISK_QUESTIONS.map((q) => (
                <div key={q.key} className="stack" style={{ gap: 6 }}>
                  <span className="small strong">{q.text}</span>
                  <div className="qopts">
                    {q.options.map((o) => (
                      <button key={o.label} type="button" className="chip" aria-pressed={answers[q.key] === o.score} onClick={() => setAnswers((a) => ({ ...a, [q.key]: o.score }))}>{o.label}</button>
                    ))}
                  </div>
                </div>
              ))}
              {quizProfile ? (
                <div className="row-between">
                  <span className="small">Your answers suggest <strong>{PROFILE_LABELS[quizProfile]}</strong> (score {score}).</span>
                  <Button size="sm" variant="primary" onClick={() => { update((w) => ({ ...w, settings: { ...w.settings, riskProfile: quizProfile } })); setBasis(quizProfile); setQuizOpen(false); toast(`Risk profile saved: ${PROFILE_LABELS[quizProfile]}`); }}>Use this profile</Button>
                </div>
              ) : <span className="tiny muted">{Object.keys(answers).length} of {RISK_QUESTIONS.length} answered</span>}
            </div>
            )}
          </Card>
        </div>

        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          {!stats || !fr ? (
            <Card><div style={{ height: 320, display: 'grid', placeItems: 'center' }} className="muted small"><span className="row"><Spinner /> Estimating class returns and risk…</span></div></Card>
          ) : (
            <>
              <div className="stats">
                <Stat label="Expected return today" value={cur ? fmt.pct(cur.ret * 100, 1) : '–'} note={cur ? `volatility ${fmt.pct(cur.vol * 100, 1)}` : 'no liquid assets'} />
                <Stat label="Suggested mix" value={rec ? fmt.pct(rec.ret * 100, 1) : '–'} note={rec ? `volatility ${fmt.pct(rec.vol * 100, 1)}` : ''} />
                <Stat label="Return per unit of risk" value={rec && cur ? `${((cur.ret - rf) / (cur.vol || 1)).toFixed(2)} → ${((rec.ret - rf) / (rec.vol || 1)).toFixed(2)}` : '–'} note="Sharpe ratio vs T-bills" />
                <Stat label="Est. tax to rebalance" value={trades ? fmt.money(trades.totalTax) : '–'} note="CGT on sales at your filer status" />
              </div>
              {basis === 'samerisk' && cur && rec && rec.ret - cur.ret < 0.002 && (
                <Callout tone="good">Your mix is already close to the best return available for its level of risk. Earning more would mean taking more risk: compare the Max Sharpe mix or a model portfolio.</Callout>
              )}
              <Card className="chart-card" title="Efficient frontier" sub="One-year expected return and volatility in rupees for mixes of the six classes">
                <ChartFrame
                  legend={<>
                    <LegendItem kind="line" color={colors.series[0]} label="Best mixes within your limits" />
                    <LegendItem color={colors.ink} label="You today" />
                    <LegendItem color={colors.series[1]} label="Suggested" />
                    <LegendItem color={colors.other} label="Model portfolios" />
                    {tgt && <LegendItem color={colors.series[2]} label="Your target" />}
                  </>}
                  chart={<FrontierChart frontier={frontier} points={points} height={360} ariaLabel="Efficient frontier with your portfolio and model portfolios" />}
                  table={() => (
                    <table className="t compact"><thead><tr><th>Mix</th><th className="num">Expected return</th><th className="num">Volatility</th></tr></thead>
                      <tbody>{points.map((p) => <tr key={p.name}><td>{p.name}</td><td className="num">{fmt.pct(p.ret * 100, 1)}</td><td className="num">{fmt.pct(p.vol * 100, 1)}</td></tr>)}</tbody>
                    </table>
                  )}
                  note="Points on the line give the most return for their risk. Mixes below the line can do better without taking more risk."
                />
              </Card>
              {recW && drift && trades && (
                <>
                  <Card className="chart-card" title="Today versus suggested" sub={`Liquid assets worth ${fmt.money(mix.total)}${mix.locked > 0 ? `; ${fmt.money(mix.locked)} in property and locked assets is left out` : ''}`}>
                    <ChartFrame
                      legend={<><LegendItem color={colors.other} label="Today" /><LegendItem color={colors.series[1]} label="Suggested" /></>}
                      chart={<PairedBars labels={drift.labels} a={{ name: 'Today', data: drift.a, color: colors.other }} b={{ name: 'Suggested', data: drift.b, color: colors.series[1] }} fmtVal={fmtPctA} height={300} ariaLabel="Current versus suggested mix" />}
                    />
                  </Card>
                  <Card flush title="Trades to get there" sub={shariah ? 'Showing Shariah-compliant ways to implement each class' : 'Asset-class level; pick specific products yourself'}>
                    <div className="table-wrap">
                      <table className="t">
                        <thead><tr><th>Class</th><th className="num">Today</th><th className="num">Suggested</th><th className="num">Buy or sell</th><th className="num">Est. tax</th><th>How to implement</th></tr></thead>
                        <tbody>
                          {OPT_CLASSES.map((c, i) => {
                            const tr = trades.trades[i];
                            return (
                              <tr key={c}>
                                <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><span className="swatch" style={{ background: optColor(colors.series, c) }} />{OPT_LABELS[c]}</span></td>
                                <td className="num">{fmt.pct(mix.weights[i] * 100, 1)}</td>
                                <td className="num strong">{fmt.pct(recW[i] * 100, 1)}</td>
                                <td className={'num ' + (Math.abs(tr.trade) < mix.total * 0.005 ? 'muted' : tr.trade > 0 ? 'up' : 'down')}>{Math.abs(tr.trade) < mix.total * 0.005 ? 'Hold' : `${tr.trade > 0 ? 'Buy' : 'Sell'} ${fmt.money(Math.abs(tr.trade))}`}</td>
                                <td className="num">{tr.estTax > 0 ? fmt.money(tr.estTax) : '–'}</td>
                                <td className="small ink2" style={{ minWidth: 220 }}>{shariah ? OPT_HOWTO[c].islamic : OPT_HOWTO[c].conventional}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                  {trades.totalTax > mix.total * 0.01 && (
                    <Callout tone="warn">Selling now would cost about {fmt.money(trades.totalTax)} in capital gains tax. Moving there with new monthly money instead avoids most of it: set this as your target mix and let contributions do the work.</Callout>
                  )}
                </>
              )}
              <div className="row" style={{ gap: 8 }}>
                <Pill tone="neutral">Educational, not advice</Pill>
                <span className="mini-help">Expected returns and risk come from the assumptions on the Markets screen, measured over one year in rupees. The model cannot see costs of switching, your liquidity needs or views on specific securities.</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
