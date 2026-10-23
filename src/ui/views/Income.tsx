import React, { useMemo, useState } from 'react';
import { CLASS_META } from '../../engine/catalog';
import { todayISO } from '../../engine/format';
import { calendarBySource, incomeLines, nextMonths, SOURCE_LABELS, SOURCE_ORDER, type IncomeSource } from '../../engine/income';
import { computeTotals } from '../../engine/valuation';
import { useForecast } from '../../state/analytics';
import { useFilteredHoldings, useUI, useWS } from '../../state/store';
import { ChartFrame, LegendItem, alpha, classColor, useColors } from '../charts/base';
import { BandLineChart, StackedBars } from '../charts/charts';
import { Button, Callout, Card, Empty, Meter, Seg, Stat, Toggle } from '../components/primitives';
import { useFmt } from '../fmt';
import { ExampleBanner, PageHead } from './common';
import { makeConverter } from './Forecast';

const PAYOUT_LABEL: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Twice a year', annual: 'Yearly', maturity: 'At maturity', none: 'Not paid out' };

export function sourceColor(series: string[], other: string, s: IncomeSource): string {
  const slot: Record<IncomeSource, number> = { dividends: 0, funds: 1, profit: 2, rent: 4, foreign: 5, other: -1 };
  return slot[s] >= 0 ? series[slot[s]] : other;
}

export function Income() {
  const { ws, active, updatePortfolio } = useWS();
  const { askAI, openEditor } = useUI();
  const holdings = useFilteredHoldings();
  const fmt = useFmt();
  const colors = useColors();
  const [after, setAfter] = useState<'gross' | 'net'>('net');
  const today = todayISO();
  const filer = ws.settings.filer;
  const lines = useMemo(() => incomeLines(holdings, ws.market, filer, today), [holdings, ws.market, filer, today]);
  const t = useMemo(() => computeTotals(holdings, [], ws.market), [holdings, ws.market]);
  const gross = lines.reduce((s, l) => s + l.gross, 0);
  const tax = lines.reduce((s, l) => s + l.tax, 0);
  const net = gross - tax;
  const exp = ws.settings.monthlyExpenses * 12;
  const fi = exp > 0 ? net / exp : 0;
  const shown = after === 'net' ? net : gross;

  const months = useMemo(() => nextMonths(today), [today]);
  const cal = useMemo(() => {
    const factor = (l: (typeof lines)[number]) => (after === 'net' || l.net === 0 ? 1 : l.gross / l.net);
    const bySrc = calendarBySource(lines.map((l) => ({ ...l, schedule: l.schedule.map((x) => x * factor(l)) })));
    const present = SOURCE_ORDER.filter((s) => bySrc[s].some((v) => v > 0));
    return {
      labels: months.map((m) => m.label),
      present,
      series: present.map((s) => ({ name: SOURCE_LABELS[s], data: bySrc[s].map((v) => fmt.conv(v)), color: sourceColor(colors.series, colors.other, s) })),
    };
  }, [lines, months, after, colors, fmt]);
  const calTotal = cal.series.reduce((s, x) => s + x.data.reduce((a, b) => a + b, 0), 0);
  const notCal = Math.max(0, fmt.conv(shown) - calTotal);

  const bySource = useMemo(() => SOURCE_ORDER.map((s) => ({ s, gross: lines.filter((l) => l.source === s).reduce((a, l) => a + l.gross, 0), net: lines.filter((l) => l.source === s).reduce((a, l) => a + l.net, 0) })).filter((x) => x.gross > 0), [lines]);

  const fc = useForecast({ samplePaths: 0 });
  const res = fc.res;
  const proj = useMemo(() => {
    if (!res || !res.incomePct.length) return null;
    const conv = makeConverter(res, ws.settings.baseCurrency, ws.settings.realTerms, ws.assumptions.macro.usInflation);
    const startYear = Number(today.slice(0, 4));
    const idx = res.points.map((_, k) => k).filter((k) => k > 0);
    return {
      labels: idx.map((k) => String(startYear + Math.round(res.points[k] / 12))),
      p10: idx.map((k) => conv(res.incomePct[1][k], k)),
      p50: idx.map((k) => conv(res.incomePct[3][k], k)),
      p90: idx.map((k) => conv(res.incomePct[5][k], k)),
    };
  }, [res, ws.settings.baseCurrency, ws.settings.realTerms, ws.assumptions.macro.usInflation, today]);

  const explain = () => askAI(
    `Review my passive income. Before tax ${fmt.money(gross)} a year, after tax ${fmt.money(net)} (${filer ? 'filer' : 'non-filer'} rates), a ${t.incomeYield.toFixed(2)}% yield on ${fmt.money(t.assets)} of assets; it covers ${(fi * 100).toFixed(0)}% of my ${fmt.money(exp)} yearly expenses. By source after tax: ${bySource.map((b) => `${SOURCE_LABELS[b.s]} ${fmt.money(b.net)}`).join(', ')}. Which sources beat inflation of ${ws.market.cpi}% after tax, and how could I raise reliable income without much more risk?`,
    true,
    'Review my passive income',
  );

  if (!holdings.length) {
    return (
      <div className="stack">
        <PageHead title="Income" />
        <Card><Empty icon="income" title="No income yet" action={<Button variant="primary" icon="plus" onClick={() => openEditor(null)}>Add holding</Button>}>Dividends, profit, rent and coupons appear here once you add holdings.</Empty></Card>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Income"
        sub={`Dividends, profit, rent and coupons at today’s values and rates, with ${filer ? 'filer' : 'non-filer'} withholding tax for ${'TY2027'}.`}
        actions={<>
          <Seg label="Show income" value={after} onChange={setAfter} options={[{ value: 'net', label: 'After tax' }, { value: 'gross', label: 'Before tax' }]} />
          <Button variant="ai" icon="sparkle" onClick={explain}>Explain with AI</Button>
        </>}
      />
      <ExampleBanner />
      <div className="stats">
        <Stat label={`Yearly income, ${after === 'net' ? 'after' : 'before'} tax`} value={fmt.money(shown)} note={`${fmt.money(shown / 12)} a month on average`} />
        <Stat label="Tax withheld" value={fmt.money(tax)} note={`${gross > 0 ? fmt.pct((tax / gross) * 100, 1) : '0%'} of gross income`} />
        <Stat label="Cash yield" value={fmt.pct(t.assets > 0 ? (shown / t.assets) * 100 : 0, 2)} note={`on ${fmt.money(t.assets)} of assets`} />
        <Stat label="Cash yield minus inflation" value={fmt.pct((t.assets > 0 ? (net / t.assets) * 100 : 0) - ws.market.cpi, 1, true)} note={`after tax, against ${fmt.pct(ws.market.cpi, 1)} CPI; growth comes on top`} title="After-tax cash yield minus current CPI inflation. Capital growth is not included." />
      </div>
      <div className="grid">
        <Card className="span-8 chart-card" title="Payout calendar, next 12 months" sub={`${after === 'net' ? 'After' : 'Before'} tax · by source · ${fmt.base}`}>
          {cal.series.length ? (
            <ChartFrame
              legend={cal.present.map((s) => <LegendItem key={s} color={sourceColor(colors.series, colors.other, s)} label={SOURCE_LABELS[s]} />)}
              chart={<StackedBars labels={cal.labels} series={cal.series} fmtVal={fmt.baseC} fmtAxis={fmt.axis} height={300} ariaLabel="Expected income by month and source" />}
              table={() => (
                <table className="t compact"><thead><tr><th>Month</th>{cal.series.map((s) => <th key={s.name} className="num">{s.name}</th>)}<th className="num">Total</th></tr></thead>
                  <tbody>{cal.labels.map((l, i) => <tr key={l}><td>{l}</td>{cal.series.map((s) => <td key={s.name} className="num">{s.data[i] ? fmt.base$(s.data[i]) : '–'}</td>)}<td className="num strong">{fmt.base$(cal.series.reduce((a, s) => a + s.data[i], 0))}</td></tr>)}</tbody>
                </table>
              )}
              note={`Typical payout months: PSX dividends in March and September, quarterly foreign dividends, monthly profit and rent.${notCal > 1 ? ` ${fmt.base$(notCal)} accrues without a payout date (for example profit paid at maturity after the next 12 months).` : ''}`}
            />
          ) : <p className="small muted">None of your holdings pays income on a schedule.</p>}
        </Card>
        <Card className="span-4" title="Financial independence" sub="How much of your spending passive income already covers">
          <div className="stack">
            <div className="strong" style={{ fontSize: 30 }}>{fmt.pct(fi * 100, 0)}</div>
            <Meter value={Math.min(1, fi)} color={fi >= 1 ? colors.good : fi >= 0.5 ? colors.warn : colors.series[0]} label="Share of expenses covered by after-tax income" />
            <div className="small ink2">{fmt.money(net / 12)} a month after tax against {fmt.money(ws.settings.monthlyExpenses)} of expenses.{fi < 1 && exp > 0 && net > 0 && t.assets > 0 ? ` At today’s ${fmt.pct((net / t.assets) * 100, 1)} after-tax yield, covering the rest would take about ${fmt.money((exp - net) / (net / t.assets))} more invested the same way.` : ''}</div>
            <p className="tiny muted">Change monthly expenses on the Goals or Settings screen. Income from fixed-rate products falls in real terms when inflation is high.</p>
          </div>
        </Card>
        <Card className="span-12 chart-card" title="Projected yearly income" sub={`${ws.settings.realTerms ? "Today's money" : 'Nominal'} · ${fmt.base} · before tax · median with the P10 to P90 range, from the forecast`}
          actions={<Toggle checked={active.plan.reinvestIncome} onChange={(b) => updatePortfolio((p) => ({ ...p, plan: { ...p.plan, reinvestIncome: b } }))} label="Reinvest income in the forecast" />}>
          {proj ? (
            <ChartFrame
              legend={<><LegendItem kind="line" color={colors.series[2]} label="Median" /><LegendItem color={alpha(colors.series[2], 0.3)} label="P10 to P90" /></>}
              chart={<BandLineChart labels={proj.labels} median={proj.p50} low={proj.p10} high={proj.p90} name="Yearly income" color={colors.series[2]} fmtVal={fmt.baseC} fmtAxis={fmt.axis} height={260} ariaLabel="Projected yearly income" />}
              table={() => (
                <table className="t compact"><thead><tr><th>Year</th><th className="num">P10</th><th className="num">Median</th><th className="num">P90</th></tr></thead>
                  <tbody>{proj.labels.map((l, i) => <tr key={l + i}><td>{l}</td><td className="num">{fmt.base$(proj.p10[i])}</td><td className="num">{fmt.base$(proj.p50[i])}</td><td className="num">{fmt.base$(proj.p90[i])}</td></tr>)}</tbody>
                </table>
              )}
              note={active.plan.reinvestIncome ? 'Income is reinvested, so it compounds and grows with the portfolio and your SIP.' : 'Income is paid out to you, so the portfolio grows more slowly and income grows mainly with rates, rents and dividends.'}
            />
          ) : <div style={{ height: 260, display: 'grid', placeItems: 'center' }} className="muted small">{fc.error ? `Forecast failed: ${fc.error}` : 'Simulating…'}</div>}
        </Card>
        <Card className="span-12" flush title="Income by holding" sub="Yearly, at today’s values and rates">
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Holding</th><th>Source</th><th className="hide-sm">Paid</th><th className="num">Before tax</th><th className="num">Tax</th><th className="num">After tax</th><th className="num hide-sm">Monthly</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><span className="swatch" style={{ background: classColor(colors, CLASS_META[l.cls].slot) }} /><span className="cell-name"><span className="n1">{l.name}</span></span></div></td>
                    <td className="small">{SOURCE_LABELS[l.source]}</td>
                    <td className="small hide-sm">{PAYOUT_LABEL[l.payout] ?? l.payout}</td>
                    <td className="num">{fmt.money(l.gross)}</td>
                    <td className="num muted">{l.tax > 0 ? fmt.money(l.tax) : '–'}</td>
                    <td className="num strong">{fmt.money(l.net)}</td>
                    <td className="num hide-sm">{fmt.money(l.net / 12)}</td>
                  </tr>
                ))}
                <tr className="total"><td colSpan={3}>Total</td><td className="num">{fmt.money(gross)}</td><td className="num">{fmt.money(tax)}</td><td className="num">{fmt.money(net)}</td><td className="num hide-sm">{fmt.money(net / 12)}</td></tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      {!filer && <Callout tone="warn">Non-filer rates apply: withholding on dividends and profit is roughly double. Joining the Active Taxpayers List would raise your after-tax income by about {fmt.money(tax / 2)} a year on these holdings.</Callout>}
      <p className="mini-help">Growth funds that do not distribute are excluded because they pay no cash. Rent is shown net of vacancy and costs, with rent tax by slab. Figures are estimates under TY2027 rates.</p>
    </div>
  );
}
