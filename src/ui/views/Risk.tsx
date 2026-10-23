import React, { useMemo, useState } from 'react';
import { CLASS_META, LIQUIDITY_META } from '../../engine/catalog';
import { concentration, histogram } from '../../engine/risk';
import type { Liquidity } from '../../engine/types';
import { computeTotals, filtersActive, holdingClass, liquidityOf, sectorOf, valuePKR } from '../../engine/valuation';
import { useRisk } from '../../state/analytics';
import { useFilteredHoldings, useUI, useWS } from '../../state/store';
import { ChartFrame, LegendItem, alpha, classColor, useColors } from '../charts/base';
import { CorrelationHeatmap, Histogram, PairedBars } from '../charts/charts';
import { BarList, Button, Card, Empty, KV, Seg, Spinner, Stat } from '../components/primitives';
import { useFmt } from '../fmt';
import { ExampleBanner, PageHead } from './common';

const LIQ_ORDER: Liquidity[] = ['instant', 'days', 'weeks', 'months', 'locked'];
const fmtPctV = (v: number) => `${v.toFixed(1)}%`;
const fmtPctA = (v: number) => `${Math.round(v)}%`;

export function Risk() {
  const { ws, active } = useWS();
  const { askAI, filters, openEditor } = useUI();
  const holdings = useFilteredHoldings();
  const fmt = useFmt();
  const colors = useColors();
  const [years, setYears] = useState<'1' | '3'>('1');
  const months = years === '3' ? 36 : 12;
  const risk = useRisk(undefined, true, months);
  const r = risk.report;
  const t = useMemo(() => computeTotals(holdings, filtersActive(filters) ? [] : active.liabilities, ws.market), [holdings, active.liabilities, ws.market, filters]);
  const conc = useMemo(() => concentration(holdings, ws.market, sectorOf), [holdings, ws.market]);
  const horizonLabel = years === '3' ? '3-year' : '1-year';

  const dist = useMemo(() => {
    if (!r) return null;
    const pct = Array.from(r.returns, (x) => x * 100);
    const h = histogram(pct, 40);
    const sorted = [...pct].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
    return { h, markers: [{ value: q(0.05), label: 'Worst 5%' }, { value: q(0.5), label: 'Median' }] };
  }, [r]);

  const contrib = useMemo(() => {
    if (!r) return null;
    const rows = [...r.classes].sort((a, b) => b.weight - a.weight);
    return {
      labels: rows.map((c) => CLASS_META[c.cls].label),
      weight: rows.map((c) => c.weight * 100),
      risk: rows.map((c) => c.riskContrib * 100),
      rows,
    };
  }, [r]);

  const ladder = useMemo(() => {
    const by: Record<Liquidity, number> = { instant: 0, days: 0, weeks: 0, months: 0, locked: 0 };
    holdings.forEach((h) => (by[liquidityOf(h)] += valuePKR(h, ws.market)));
    const total = Object.values(by).reduce((a, b) => a + b, 0) || 1;
    let cum = 0;
    return LIQ_ORDER.map((l, i) => {
      cum += by[l];
      return { key: l, label: LIQUIDITY_META[l].label, detail: LIQUIDITY_META[l].detail, value: by[l], frac: by[l] / total, cum: cum / total, color: alpha(colors.series[0], 1 - i * 0.17) };
    });
  }, [holdings, ws.market, colors]);

  const explain = () => {
    if (!r) return;
    askAI(
      `Explain my portfolio's risk in plain words and suggest two ways to reduce it without giving up much return. ${horizonLabel} figures: expected return ${(r.mean * 100).toFixed(1)}%, volatility ${(r.sd * 100).toFixed(1)}%, 95% value at risk ${(r.var95 * 100).toFixed(1)}% (${fmt.money(r.var95 * r.total)}), CVaR ${(r.cvar95 * 100).toFixed(1)}%, chance of a loss ${(r.probLoss * 100).toFixed(0)}%, Sharpe ${r.sharpe.toFixed(2)}, beta to KSE-100 ${r.betaKse.toFixed(2)}. Risk share by class: ${r.classes.map((c) => `${CLASS_META[c.cls].label} weight ${(c.weight * 100).toFixed(0)}% / risk ${(c.riskContrib * 100).toFixed(0)}%`).join(', ')}. Largest holding ${conc.top1?.name ?? 'n/a'} at ${((conc.top1?.weight ?? 0) * 100).toFixed(0)}%, effective number of holdings ${conc.effectiveN.toFixed(1)}.`,
      true,
      'Explain my risk',
    );
  };

  if (!holdings.length) {
    return (
      <div className="stack">
        <PageHead title="Risk" />
        <Card><Empty icon="risk" title="Nothing to measure yet" action={<Button variant="primary" icon="plus" onClick={() => openEditor(null)}>Add holding</Button>}>Risk is measured from your holdings. Add some, or clear the filters.</Empty></Card>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Risk"
        sub={`How much the portfolio could lose and where the risk comes from, from ${r ? r.paths.toLocaleString() : '5,000'} simulated ${horizonLabel} paths of today’s holdings (no new money or withdrawals).`}
        actions={<>
          <Seg label="Risk horizon" value={years} onChange={setYears} options={[{ value: '1', label: '1 year' }, { value: '3', label: '3 years' }]} />
          <Button variant="ai" icon="sparkle" onClick={explain} disabled={!r}>Explain with AI</Button>
        </>}
      />
      <ExampleBanner />
      {!r ? (
        <Card><div style={{ height: 240, display: 'grid', placeItems: 'center' }} className="muted small">{risk.error ? `Risk run failed: ${risk.error}` : <span className="row"><Spinner /> Measuring risk…</span>}</div></Card>
      ) : (
        <>
          <div className="stats">
            <Stat label="Expected return" value={fmt.pct(r.mean * 100, 1)} note={`over ${years === '3' ? '3 years' : 'a year'}, average`} />
            <Stat label="Volatility" value={fmt.pct(r.sd * 100, 1)} note="standard deviation of returns" />
            <Stat label="Value at risk (95%)" value={fmt.pct(-r.var95 * 100, 1)} note={`${fmt.money(r.var95 * r.total)} lost in the worst 1 in 20`} title="The loss exceeded in 5% of simulated outcomes" />
            <Stat label="Average loss in the worst 5%" value={fmt.pct(-r.cvar95 * 100, 1)} note={`${fmt.money(r.cvar95 * r.total)} (CVaR)`} />
            <Stat label="Chance of any loss" value={fmt.pct(r.probLoss * 100, 0)} note={`trails inflation in ${fmt.pct(r.probBelowInflation * 100, 0)} of paths`} />
            <Stat label="Worst fall within the period" value={fmt.pct(-r.maxDD.median * 100, 0)} note={`typical; 1 in 10 fall ${fmt.pct(r.maxDD.p90 * 100, 0)} or more`} />
            <Stat label="Sharpe ratio" value={r.sharpe.toFixed(2)} note={`vs T-bills at ${fmt.pct(ws.market.tbill.m12, 1)} · Sortino ${r.sortino.toFixed(2)}`} />
            <Stat label="Beta to KSE-100" value={r.betaKse.toFixed(2)} note={`correlation ${r.corrKse.toFixed(2)} · S&P 500 beta ${r.betaSpx.toFixed(2)}`} />
          </div>

          <div className="grid">
            <Card className="span-7 chart-card" title={`Range of ${horizonLabel} returns`} sub="Share of simulated outcomes by portfolio return, PKR">
              {dist && (
                <ChartFrame
                  chart={<Histogram edges={dist.h.edges} counts={dist.h.counts} fmtVal={fmtPctV} markers={dist.markers} height={280} ariaLabel={`Distribution of ${horizonLabel} portfolio returns`} />}
                  table={() => (
                    <table className="t compact"><thead><tr><th>Return range</th><th className="num">Share of outcomes</th></tr></thead>
                      <tbody>{dist.h.counts.map((c, i) => <tr key={i}><td>{dist.h.edges[i].toFixed(1)}% to {dist.h.edges[i + 1].toFixed(1)}%</td><td className="num">{((c / r.paths) * 100).toFixed(1)}%</td></tr>)}</tbody>
                    </table>
                  )}
                  note="Returns are in rupees. A rupee devaluation lifts USD-linked holdings, which is why gold, foreign currency and global assets narrow the left tail."
                />
              )}
            </Card>
            <Card className="span-5 chart-card" title="Where the risk comes from" sub="Share of capital versus share of portfolio risk, by class">
              {contrib && (
                <ChartFrame
                  legend={<><LegendItem color={colors.other} label="Share of capital" /><LegendItem color={colors.series[0]} label="Share of risk" /></>}
                  chart={<PairedBars labels={contrib.labels} a={{ name: 'Share of capital', data: contrib.weight, color: colors.other }} b={{ name: 'Share of risk', data: contrib.risk, color: colors.series[0] }} fmtVal={fmtPctA} height={Math.max(200, contrib.labels.length * 46)} ariaLabel="Capital weight versus risk contribution by class" />}
                  table={() => (
                    <table className="t compact"><thead><tr><th>Class</th><th className="num">Capital</th><th className="num">Risk</th><th className="num">Volatility</th></tr></thead>
                      <tbody>{contrib.rows.map((c) => <tr key={c.cls}><td>{CLASS_META[c.cls].label}</td><td className="num">{fmt.pct(c.weight * 100, 1)}</td><td className="num">{fmt.pct(c.riskContrib * 100, 1)}</td><td className="num">{fmt.pct(c.vol * 100, 1)}</td></tr>)}</tbody>
                    </table>
                  )}
                  note="A class whose risk bar is longer than its capital bar adds more than its share of the swings. Shares can be negative when a class offsets the rest."
                />
              )}
            </Card>

            <Card className="span-6 chart-card" title="How your asset classes move together" sub={`Correlation of ${horizonLabel} returns in PKR, from the simulation`}>
              {r.corr.classes.length >= 2 ? (
                <ChartFrame
                  chart={<CorrelationHeatmap labels={r.corr.classes.map((c) => CLASS_META[c].short)} matrix={r.corr.matrix} height={Math.max(260, r.corr.classes.length * 44 + 60)} ariaLabel="Correlation heatmap between asset classes" />}
                  table={() => (
                    <table className="t compact"><thead><tr><th></th>{r.corr.classes.map((c) => <th key={c} className="num">{CLASS_META[c].short}</th>)}</tr></thead>
                      <tbody>{r.corr.classes.map((c, i) => <tr key={c}><td>{CLASS_META[c].short}</td>{r.corr.matrix[i].map((v, j) => <td key={j} className="num">{v.toFixed(2)}</td>)}</tr>)}</tbody>
                    </table>
                  )}
                  note="Blue: move together. Red: move in opposite directions, which cushions falls. Grey: unrelated."
                />
              ) : <p className="small muted">You hold a single asset class, so there is nothing to correlate.</p>}
            </Card>

            <Card className="span-6" title="Riskiest holdings" sub={`Share of total ${horizonLabel} risk each holding contributes`} flush>
              <div className="table-wrap">
                <table className="t compact">
                  <thead><tr><th>Holding</th><th className="num">Weight</th><th className="num">Risk share</th><th className="num">Volatility</th></tr></thead>
                  <tbody>
                    {r.top.slice(0, 10).map((h) => {
                      const hold = holdings.find((x) => x.id === h.id);
                      return (
                        <tr key={h.id}>
                          <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>{hold && <span className="swatch" style={{ background: classColor(colors, CLASS_META[holdingClass(hold)].slot) }} />}<span className="cell-name"><span className="n1">{hold?.ticker ? `${hold.ticker} · ${h.name}` : h.name}</span></span></div></td>
                          <td className="num">{fmt.pct(h.weight * 100, 1)}</td>
                          <td className={'num strong'}>{fmt.pct(h.riskContrib * 100, 1)}</td>
                          <td className="num">{fmt.pct(h.vol * 100, 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="span-6" title="Concentration" sub="How much rides on a few positions">
              <KV rows={[
                ['Largest holding', conc.top1 ? `${conc.top1.name} · ${fmt.pct(conc.top1.weight * 100, 1)}` : '–'],
                ['Top five holdings', fmt.pct(conc.top5 * 100, 0)],
                ['Effective number of holdings', conc.effectiveN.toFixed(1)],
                ['Largest PSX sector', conc.topSector ? `${conc.topSector.name} · ${fmt.pct(conc.topSector.weight * 100, 0)} of PSX stocks` : '–'],
                ['Hard-currency share', fmt.pct(t.hardCurrency * 100, 0)],
                ['Net worth measured', fmt.money(t.netWorth)],
              ]} />
              <p className="mini-help" style={{ marginTop: 10 }}>The effective number is 1 ÷ the sum of squared weights: ten equal holdings score 10, one dominant holding scores close to 1.</p>
            </Card>

            <Card className="span-6" title="Liquidity ladder" sub="How fast you could turn holdings into cash">
              <BarList rows={ladder.map((l) => ({ key: l.key, label: <span title={l.detail}>{l.label}</span>, value: fmt.money(l.value), sub: `${fmt.pct(l.frac * 100, 0)} · ${fmt.pct(l.cum * 100, 0)} cumulative`, frac: l.frac, color: l.color }))} />
              <p className="mini-help" style={{ marginTop: 10 }}>PSX settles in two days, funds in one to three, NSS encashment takes up to a few weeks, and property usually takes months.</p>
            </Card>
          </div>
          <p className="mini-help">Risk figures come from the same factor model as the forecast: PSX, global stocks, bonds, gold, property and crypto, correlated with the rupee, rates and inflation. Betas compare your rupee returns with the KSE-100 and the S&P 500 in rupees.</p>
        </>
      )}
    </div>
  );
}
