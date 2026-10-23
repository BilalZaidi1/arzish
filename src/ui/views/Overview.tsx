import React, { useMemo } from 'react';
import { CLASS_META } from '../../engine/catalog';
import { fmtDate, todayISO } from '../../engine/format';
import { CLASS_ORDER } from '../../engine/types';
import { computeTotals, filtersActive, holdingClass, valuePKR, costPKR } from '../../engine/valuation';
import { useForecast, useRisk } from '../../state/analytics';
import { useFilteredHoldings, useUI, useWS } from '../../state/store';
import { computeAlerts } from '../alerts';
import { FanChart } from '../charts/charts';
import { ChartFrame, LegendItem, alpha, useColors } from '../charts/base';
import { Icon } from '../components/Icon';
import { BarList, Button, Card, Empty, Meter, Pill, Stat, StackBar, probLabel, probTone } from '../components/primitives';
import { useSlots } from '../../state/slots';
import { useFmt } from '../fmt';
import { ExampleBanner, PageHead, useClassColor } from './common';
import { SpecChart } from '../ai/SpecChart';

export function forecastSeries(res: NonNullable<ReturnType<typeof useForecast>['res']>, base: 'PKR' | 'USD', real: boolean): number[][] {
  if (base === 'USD') return real ? res.usdReal : res.usd;
  return real ? res.real : res.nominal;
}

export function Overview() {
  const slots = useSlots();
  const { ws, active } = useWS();
  const { filters, go, askAI, openEditor } = useUI();
  const holdings = useFilteredHoldings();
  const fmt = useFmt();
  const colors = useColors();
  const classColor = useClassColor();
  const filtered = filtersActive(filters);
  const t = useMemo(() => computeTotals(holdings, filtered ? [] : active.liabilities, ws.market), [holdings, active.liabilities, ws.market, filtered]);
  const fc = useForecast({ samplePaths: 0 });
  const risk = useRisk();
  const today = todayISO();
  const startYear = Number(today.slice(0, 4));
  const real = ws.settings.realTerms;
  const base = ws.settings.baseCurrency;

  const alerts = useMemo(
    () => computeAlerts(active, holdings, t, ws.market, ws.settings, today, (v) => fmt.money(v), fc.res, risk.report),
    [active, holdings, t, ws.market, ws.settings, fc.res, risk.report, fmt],
  );

  const res = fc.res;
  // Memoised so the chart only redraws when the forecast or view settings change.
  const { series, labels, contribLine } = useMemo(() => {
    if (!res) return { series: null, labels: [] as string[], contribLine: undefined };
    const sr = forecastSeries(res, base, real);
    return {
      series: sr,
      labels: res.points.map((m) => String(startYear + Math.round(m / 12))),
      // "Money put in" is only meaningful in nominal rupees.
      contribLine: base === 'PKR' && !real ? res.contribCum.map((c) => sr[3][0] + c) : undefined,
    };
  }, [res, base, real, startYear]);

  if (!active.holdings.length) {
    return (
      <div className="stack">
        <PageHead title="Overview" sub={active.name} />
        <Card>
          <Empty icon="wallet" title="Add your first holding" action={<Button variant="primary" icon="plus" onClick={() => openEditor(null)}>Add holding</Button>}>
            Start with what you own: PSX shares, funds, National Savings, gold, property, foreign accounts or crypto. You can also import a statement with AI from the Holdings screen.
          </Empty>
        </Card>
      </div>
    );
  }

  const H = res ? res.points.length - 1 : 0;
  const pinned = active.pinned.slice(-2).reverse();

  const classes = CLASS_ORDER.filter((c) => t.byClass[c] > 0);
  const top = [...holdings].sort((a, b) => valuePKR(b, ws.market) - valuePKR(a, ws.market)).slice(0, 8);
  const goals = res ? res.goals.map((g) => ({ g, goal: active.goals.find((x) => x.id === g.id)! })).filter((x) => x.goal) : [];
  const cpiCagr = res ? Math.pow(res.cpiPct[3][H], 12 / res.months) - 1 : 0;
  const nomCagr = res ? res.twrCagrPct[1] / 100 : 0;
  const realCagr = (1 + nomCagr) / (1 + cpiCagr) - 1;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Overview"
        sub={<>{active.name}{filtered ? ' · filtered view' : ''} · prices as entered, market data as of {fmtDate(ws.market.asOf)}</>}
        actions={<>
          <Button icon="plus" onClick={() => openEditor(null)}>Add holding</Button>
          <Button variant="ai" icon="sparkle" onClick={() => askAI('__review__')}>AI portfolio review</Button>
        </>}
      />
      <ExampleBanner />
      {slots.overview}
      <div className="grid">
        <section className="card span-5">
          <div className="hero">
            <div className="eyebrow">{filtered ? 'Filtered assets' : 'Net worth'}</div>
            <div className="hero-value">{fmt.money(t.netWorth)}</div>
            <div className="hero-meta">
              {!filtered && t.liabilities > 0 && <span>Assets {fmt.money(t.assets)} · Liabilities {fmt.money(t.liabilities)}</span>}
              <span>{base === 'PKR' ? `≈ ${fmt.usd(t.netWorth / ws.market.fx.USD)}` : `≈ ${fmt.pkr(t.netWorth)}`} at Rs {ws.market.fx.USD.toFixed(2)} per USD</span>
            </div>
            {t.cost > 0 && (
              <div className="row">
                <span className={'pill ' + (t.pnl >= 0 ? 'good' : 'critical')}>
                  <Icon name={t.pnl >= 0 ? 'arrowUp' : 'arrowDown'} />
                  {fmt.money(t.pnl, { sign: true })} ({fmt.pct(t.pnlPct, 1, true)})
                </span>
                <span className="small muted">unrealized gain on cost{t.costCovered < t.assets ? ' where cost is recorded' : ''}</span>
              </div>
            )}
            <div className="stack" style={{ gap: 6, marginTop: 6 }}>
              <StackBar parts={classes.map((c) => ({ key: c, frac: t.byClass[c] / (t.assets || 1), color: classColor(c), label: CLASS_META[c].label }))} />
              <div className="chart-legend">
                {classes.map((c) => <LegendItem key={c} color={classColor(c)} label={`${CLASS_META[c].short} ${Math.round((t.byClass[c] / (t.assets || 1)) * 100)}%`} />)}
              </div>
            </div>
          </div>
        </section>
        <div className="span-7 stats" style={{ alignContent: 'start' }}>
          <Stat label="Expected growth" value={res ? fmt.pct(res.twrCagrPct[1], 1) : '…'} note={res ? <>a year, median · {fmt.pct(realCagr * 100, 1)} after inflation</> : 'Running forecast…'} title="Median time-weighted return across simulated paths" />
          <Stat label="Bad-year loss (1 in 20)" value={risk.report ? fmt.pct(-risk.report.var95 * 100, 1) : '…'} note={risk.report ? <>volatility {fmt.pct(risk.report.sd * 100, 1)} a year</> : 'Measuring risk…'} title="95% one-year value at risk" />
          <Stat label="Passive income" value={fmt.money(t.income)} note={<>a year before tax · {fmt.pct(t.incomeYield, 1)} yield</>} />
          <Stat label="Rupee hedge" value={fmt.pct(t.hardCurrency * 100, 0)} note="in USD-linked assets" title="Gold, foreign currency, global and crypto holdings" />
          <Stat label="Shariah-compliant" value={fmt.pct(t.shariahYes * 100, 0)} note={t.shariahUnknown > 0.005 ? `${fmt.pct(t.shariahUnknown * 100, 0)} not yet verified` : 'of assets'} />
          <Stat label="Liquid within a week" value={fmt.pct(t.liquidWeek * 100, 0)} note="of assets" />
        </div>

        <Card className="span-8 chart-card" title="Where your plan leads" sub={res ? `${res.paths.toLocaleString()} simulated paths · ${fmt.money(active.plan.sipMonthly)} a month${active.plan.sipStepUp ? `, rising ${active.plan.sipStepUp}% a year` : ''} · ${real ? "today's money" : 'nominal'} ${base}` : 'Simulating…'}
          actions={<Button size="sm" variant="ghost" icon="forecast" onClick={() => go('forecast')}>Open forecast</Button>}>
          {res && series ? (
            <>
              <div className="row" style={{ gap: '6px 18px', marginBottom: 6 }}>
                <div>
                  <div className="small muted">Median in {labels[H]}</div>
                  <div className="strong" style={{ fontSize: 20 }}>{fmt.base$(series[3][H])}</div>
                </div>
                <div>
                  <div className="small muted">1 in 10 chance below</div>
                  <div className="strong" style={{ fontSize: 20 }}>{fmt.base$(series[1][H])}</div>
                </div>
                <div>
                  <div className="small muted">1 in 10 chance above</div>
                  <div className="strong" style={{ fontSize: 20 }}>{fmt.base$(series[5][H])}</div>
                </div>
              </div>
              <ChartFrame
                legend={<>
                  <LegendItem kind="line" color={colors.series[0]} label="Median" />
                  <LegendItem color={alpha(colors.series[0], 0.45)} label="Middle half (P25–P75)" />
                  <LegendItem color={alpha(colors.series[0], 0.2)} label="8 in 10 paths (P10–P90)" />
                  {contribLine && <LegendItem kind="line" color={colors.other} label="Money put in" />}
                </>}
                chart={<FanChart labels={labels} pct={series} contrib={contribLine} fmtVal={fmt.baseC} fmtAxis={fmt.axis} height={300} dim={fc.loading} ariaLabel="Forecast fan chart of net worth" />}
                table={() => (
                  <table className="t compact">
                    <thead><tr><th>Year</th><th className="num">P10</th><th className="num">Median</th><th className="num">P90</th></tr></thead>
                    <tbody>{labels.map((l, i) => <tr key={l + i}><td>{l}</td><td className="num">{fmt.base$(series[1][i])}</td><td className="num">{fmt.base$(series[3][i])}</td><td className="num">{fmt.base$(series[5][i])}</td></tr>)}</tbody>
                  </table>
                )}
              />
            </>
          ) : (
            <div style={{ height: 360, display: 'grid', placeItems: 'center' }} className="muted small">{fc.error ? `Forecast failed: ${fc.error}` : 'Simulating your portfolio…'}</div>
          )}
        </Card>

        <Card className="span-4" title="Allocation" sub="By asset class" actions={<Button size="sm" variant="ghost" onClick={() => go('allocation')}>Details</Button>}>
          <BarList rows={classes.map((c) => ({ key: c, label: CLASS_META[c].label, value: fmt.money(t.byClass[c]), sub: fmt.pct((t.byClass[c] / (t.assets || 1)) * 100, 0), frac: t.byClass[c] / (t.assets || 1), color: classColor(c) }))} />
          {goals.length > 0 && (
            <>
              <div className="divider" style={{ margin: '16px 0 12px' }} />
              <div className="row-between" style={{ marginBottom: 8 }}>
                <div className="card-title">Goals</div>
                <button type="button" className="linkbtn small" onClick={() => go('goals')}>Plan goals</button>
              </div>
              <div className="stack" style={{ gap: 10 }}>
                {goals.map(({ g, goal }) => (
                  <div key={g.id} className="stack" style={{ gap: 4 }}>
                    <div className="row-between">
                      <span className="small strong">{goal.name}</span>
                      <Pill tone={probTone(g.prob)}>{Math.round(g.prob * 100)}% · {probLabel(g.prob)}</Pill>
                    </div>
                    <Meter value={g.prob} color={g.prob >= 0.8 ? colors.good : g.prob >= 0.5 ? colors.warn : colors.critical} label={`${goal.name} probability`} />
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card className="span-6" title="Checks and alerts" sub="Rule-based checks on concentration, liquidity, currency, tax and goals">
          <div>
            {alerts.map((a) => (
              <div className="alert-item" key={a.key}>
                <Pill tone={a.tone}>{a.tone === 'good' ? 'OK' : a.tone === 'neutral' ? 'Note' : a.tone === 'warn' ? 'Watch' : 'Act'}</Pill>
                <div className="a-title">{a.title}</div>
                <div className="a-body">{a.body}{a.view && <> <button type="button" className="linkbtn small" onClick={() => go(a.view!)}>Review</button></>}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="span-6" title="Largest holdings" flush actions={<Button size="sm" variant="ghost" onClick={() => go('holdings')}>All holdings</Button>}>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Holding</th><th className="num">Value</th><th className="num">Weight</th><th className="num">Gain</th></tr></thead>
              <tbody>
                {top.map((h) => {
                  const v = valuePKR(h, ws.market);
                  const c = costPKR(h, ws.market);
                  const g = c !== undefined && c > 0 ? (v / c - 1) * 100 : undefined;
                  return (
                    <tr key={h.id}>
                      <td>
                        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                          <span className="swatch" style={{ background: classColor(holdingClass(h)) }} />
                          <div className="cell-name"><span className="n1">{h.ticker ? `${h.ticker} · ${h.name}` : h.name}</span><span className="n2">{CLASS_META[holdingClass(h)].label}</span></div>
                        </div>
                      </td>
                      <td className="num">{fmt.money(v)}</td>
                      <td className="num">{fmt.pct((v / (t.assets || 1)) * 100, 1)}</td>
                      <td className={'num ' + (g === undefined ? 'muted' : g >= 0 ? 'up' : 'down')}>{g === undefined ? '–' : fmt.pct(g, 1, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {pinned.length > 0 && (
          <Card className="span-12" title="Pinned AI charts" actions={<Button size="sm" variant="ghost" onClick={() => go('insights')}>All insights</Button>}>
            <div className="grid">
              {pinned.map((p) => (
                <div key={p.id} className="span-6"><SpecChart spec={p.spec} height={240} /></div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
