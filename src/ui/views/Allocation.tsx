import React, { useMemo, useState } from 'react';
import { CLASS_META, LIQUIDITY_META, fundCategory } from '../../engine/catalog';
import { concentration } from '../../engine/risk';
import { currentMix, OPT_LABELS } from '../../engine/optimize';
import type { AssetClass, Holding, MarketSnapshot } from '../../engine/types';
import { CLASS_ORDER, OPT_CLASSES } from '../../engine/types';
import { computeTotals, cryptoKind, geographyOf, globalTicker, holdingClass, liquidityOf, sectorOf, shariahOf, subLabel, valuePKR } from '../../engine/valuation';
import { useFilteredHoldings, useUI, useWS } from '../../state/store';
import { ChartFrame, LegendItem, alpha, classColor, useColors } from '../charts/base';
import { PairedBars, Treemap } from '../charts/charts';
import { BarList, Button, Callout, Card, Chip, Empty, StackBar, Stat, Toggle } from '../components/primitives';
import { useFmt } from '../fmt';
import { ExampleBanner, PageHead } from './common';
import { optColor } from './Optimizer';

type Dim = 'class' | 'sub' | 'sector' | 'geo' | 'currency' | 'shariah' | 'liquidity' | 'risk' | 'account';
const DIMS: { value: Dim; label: string }[] = [
  { value: 'class', label: 'Asset class' },
  { value: 'sub', label: 'Sub-type' },
  { value: 'sector', label: 'PSX sector' },
  { value: 'geo', label: 'Geography' },
  { value: 'currency', label: 'Currency' },
  { value: 'shariah', label: 'Shariah' },
  { value: 'liquidity', label: 'Liquidity' },
  { value: 'risk', label: 'Risk level' },
  { value: 'account', label: 'Owner' },
];
const LOOK_DIMS: Dim[] = ['class', 'geo', 'currency'];

export type RiskBucket = 'Low' | 'Moderate' | 'High' | 'Very high';
export const RISK_BUCKETS: RiskBucket[] = ['Low', 'Moderate', 'High', 'Very high'];

/** Typical-volatility bucket for a holding (a rough guide, not a forecast). */
export function riskBucket(h: Holding): RiskBucket {
  switch (h.type) {
    case 'cash':
    case 'deposit':
    case 'nss':
    case 'retirement':
      return 'Low';
    case 'govt_sec':
      return h.sub === 'pib_fixed' ? 'Moderate' : 'Low';
    case 'fx_cash':
      return 'Moderate';
    case 'mutual_fund':
    case 'vps': {
      const c = fundCategory(h.type, h.sub);
      const eq = c.mix.eq + c.mix.global;
      if (c.mix.gold > 0.5) return 'High';
      if (eq >= 0.7) return 'Very high';
      if (eq >= 0.3) return 'High';
      if (c.key.includes('income') || c.key === 'vps_debt' || c.key === 'aggressive_income') return 'Moderate';
      return 'Low';
    }
    case 'gold':
    case 'silver':
      return 'High';
    case 'property':
      return 'Moderate';
    case 'psx_stock':
    case 'psx_etf':
      return 'Very high';
    case 'global_bond':
      return 'Moderate';
    case 'global_etf': {
      const t = globalTicker(h.ticker);
      return t?.kind === 'bond' ? 'Moderate' : t?.kind === 'crypto' ? 'Very high' : 'High';
    }
    case 'global_stock':
      return 'Very high';
    case 'crypto':
      return cryptoKind(h).stable ? 'Moderate' : 'Very high';
    case 'business':
      return 'Very high';
    default:
      return (h.vol ?? 12) < 5 ? 'Low' : (h.vol ?? 12) < 12 ? 'Moderate' : (h.vol ?? 12) < 25 ? 'High' : 'Very high';
  }
}

interface Row { key: string; label: string; value: number; color: string; sub?: string }

function lookThrough(h: Holding, v: number): { cls: AssetClass; v: number }[] {
  if (h.type !== 'mutual_fund' && h.type !== 'vps') return [{ cls: holdingClass(h), v }];
  const c = fundCategory(h.type, h.sub);
  const m = c.mix;
  const out: { cls: AssetClass; v: number }[] = [];
  if (m.eq) out.push({ cls: 'psx', v: v * m.eq });
  if (m.income + m.cash) out.push({ cls: 'fixed', v: v * (m.income + m.cash) });
  if (m.gold) out.push({ cls: 'gold', v: v * m.gold });
  if (m.global) out.push({ cls: 'global', v: v * m.global });
  return out.length ? out : [{ cls: holdingClass(h), v }];
}

function buildRows(dim: Dim, holdings: Holding[], m: MarketSnapshot, look: boolean, series: string[], other: string, accounts: string[]): Row[] {
  const acc = new Map<string, Row>();
  const add = (key: string, label: string, v: number, color: string) => {
    const r = acc.get(key) ?? { key, label, value: 0, color };
    r.value += v;
    acc.set(key, r);
  };
  const clsColor = (c: AssetClass) => (CLASS_META[c].slot >= 1 ? series[CLASS_META[c].slot - 1] : other);
  for (const h of holdings) {
    const v = valuePKR(h, m);
    if (v <= 0) continue;
    switch (dim) {
      case 'class':
        (look ? lookThrough(h, v) : [{ cls: holdingClass(h), v }]).forEach((p) => add(p.cls, CLASS_META[p.cls].label, p.v, clsColor(p.cls)));
        break;
      case 'sub':
        add(h.type + ':' + (h.sub ?? ''), subLabel(h), v, clsColor(holdingClass(h)));
        break;
      case 'sector':
        if (h.type === 'psx_stock' || h.type === 'psx_etf') add(sectorOf(h), sectorOf(h), v, series[0]);
        break;
      case 'geo': {
        if (look && (h.type === 'mutual_fund' || h.type === 'vps')) {
          const g = fundCategory(h.type, h.sub).mix.global;
          if (g) add('International', 'International', v * g, series[5]);
          if (1 - g > 0) add('Pakistan', 'Pakistan', v * (1 - g), series[0]);
        } else {
          const g = geographyOf(h);
          add(g, g, v, g === 'Pakistan' ? series[0] : series[5]);
        }
        break;
      }
      case 'currency': {
        const curColor: Record<string, string> = { PKR: series[0], USD: series[1], AED: series[2], SAR: series[5], GBP: series[4], EUR: series[6], LINKED: series[3] };
        if (look && h.currency === 'PKR') {
          let linked = 0;
          if (h.type === 'gold' || h.type === 'silver') linked = 1;
          else if (h.type === 'mutual_fund' || h.type === 'vps') {
            const mx = fundCategory(h.type, h.sub).mix;
            linked = mx.gold + mx.global;
          }
          if (linked) add('LINKED', 'PKR, priced off USD', v * linked, curColor.LINKED);
          if (1 - linked > 0) add('PKR', 'PKR', v * (1 - linked), curColor.PKR);
        } else add(h.currency, h.currency, v, curColor[h.currency] ?? other);
        break;
      }
      case 'shariah': {
        const s = shariahOf(h);
        add(s, s === 'yes' ? 'Shariah-compliant' : s === 'no' ? 'Not compliant' : 'Not verified', v, s === 'yes' ? series[2] : s === 'no' ? series[1] : other);
        break;
      }
      case 'liquidity': {
        const l = liquidityOf(h);
        add(l, LIQUIDITY_META[l].label, v, alpha(series[0], 1 - LIQUIDITY_META[l].order * 0.17));
        break;
      }
      case 'risk': {
        const b = riskBucket(h);
        add(b, b, v, alpha(series[1], [0.35, 0.55, 0.78, 1][RISK_BUCKETS.indexOf(b)]));
        break;
      }
      case 'account': {
        const a = h.account ?? 'Self';
        add(a, a, v, series[Math.max(0, accounts.indexOf(a)) % 8]);
        break;
      }
    }
  }
  const rows = Array.from(acc.values());
  const order = (r: Row) => {
    if (dim === 'class') return CLASS_ORDER.indexOf(r.key as AssetClass);
    if (dim === 'liquidity') return LIQUIDITY_META[r.key as keyof typeof LIQUIDITY_META].order;
    if (dim === 'risk') return RISK_BUCKETS.indexOf(r.key as RiskBucket);
    return -r.value;
  };
  return rows.sort((a, b) => order(a) - order(b));
}

export function Allocation() {
  const { ws, active } = useWS();
  const { askAI, go, openEditor } = useUI();
  const holdings = useFilteredHoldings();
  const fmt = useFmt();
  const colors = useColors();
  const [dim, setDim] = useState<Dim>('class');
  const [look, setLook] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const accounts = useMemo(() => Array.from(new Set(active.holdings.map((h) => h.account ?? 'Self'))).sort(), [active.holdings]);
  const rows = useMemo(() => buildRows(dim, holdings, ws.market, look && LOOK_DIMS.includes(dim), colors.series, colors.other, accounts), [dim, holdings, ws.market, look, colors, accounts]);
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  const t = useMemo(() => computeTotals(holdings, [], ws.market), [holdings, ws.market]);
  const conc = useMemo(() => concentration(holdings, ws.market, sectorOf), [holdings, ws.market]);

  const tree = useMemo(() => CLASS_ORDER.map((c) => {
    const items = holdings.filter((h) => holdingClass(h) === c).map((h) => ({ name: h.ticker ?? h.name, value: valuePKR(h, ws.market) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    return { name: CLASS_META[c].label, value: items.reduce((s, x) => s + x.value, 0), color: classColor(colors, CLASS_META[c].slot), children: items };
  }).filter((d) => d.value > 0), [holdings, ws.market, colors]);

  const mix = useMemo(() => currentMix(holdings, ws.market), [holdings, ws.market]);
  const target = active.targetMix;
  const drift = useMemo(() => {
    if (!target) return null;
    const tw = OPT_CLASSES.map((c) => target[c] ?? 0);
    const ts = tw.reduce((a, b) => a + b, 0) || 1;
    return OPT_CLASSES.map((c, i) => ({ c, cur: mix.weights[i] * 100, tgt: (tw[i] / ts) * 100, trade: (tw[i] / ts) * mix.total - mix.values[c] }));
  }, [target, mix]);
  const driftChart = useMemo(() => (drift ? { labels: drift.map((d) => OPT_LABELS[d.c]), a: drift.map((d) => d.cur), b: drift.map((d) => d.tgt) } : null), [drift]);
  const maxDrift = drift ? Math.max(...drift.map((d) => Math.abs(d.cur - d.tgt))) : 0;

  const dimLabel = DIMS.find((d) => d.value === dim)!.label;
  const explain = () => askAI(
    `Look at how my portfolio is allocated and tell me what stands out: concentration, missing diversifiers, rupee exposure, Shariah status and liquidity. Allocation by ${dimLabel.toLowerCase()}${look && LOOK_DIMS.includes(dim) ? ' (with fund look-through)' : ''}: ${rows.map((r) => `${r.label} ${((r.value / total) * 100).toFixed(1)}%`).join(', ')}. Effective number of holdings ${conc.effectiveN.toFixed(1)}; largest holding ${conc.top1?.name ?? 'n/a'} at ${((conc.top1?.weight ?? 0) * 100).toFixed(0)}%.`,
    true,
    `Review my allocation by ${dimLabel.toLowerCase()}`,
  );

  if (!holdings.length) {
    return (
      <div className="stack">
        <PageHead title="Allocation" />
        <Card><Empty icon="allocation" title="Nothing to break down yet" action={<Button variant="primary" icon="plus" onClick={() => openEditor(null)}>Add holding</Button>}>Add holdings, or clear the filters, to see what you really own.</Empty></Card>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Allocation"
        sub="What you really own, sliced nine ways. Fund look-through splits balanced and asset-allocation funds into the stocks, debt, gold and foreign assets inside them."
        actions={<Button variant="ai" icon="sparkle" onClick={explain}>Explain with AI</Button>}
      />
      <ExampleBanner />
      <div className="stats">
        <Stat label="Assets in view" value={fmt.money(t.assets)} note={`${holdings.length} holdings`} />
        <Stat label="Largest class" value={(() => { const c = CLASS_ORDER.reduce((b, x) => (t.byClass[x] > t.byClass[b] ? x : b), 'psx' as AssetClass); return CLASS_META[c].short; })()} note={fmt.pct((Math.max(...CLASS_ORDER.map((c) => t.byClass[c])) / (t.assets || 1)) * 100, 0) + ' of assets'} />
        <Stat label="Effective holdings" value={conc.effectiveN.toFixed(1)} note="1 ÷ sum of squared weights" />
        <Stat label="Hard-currency linked" value={fmt.pct(t.hardCurrency * 100, 0)} note="gold, FX, global, crypto" />
        <Stat label="Shariah-compliant" value={fmt.pct(t.shariahYes * 100, 0)} note={t.shariahUnknown > 0.005 ? `${fmt.pct(t.shariahUnknown * 100, 0)} not verified` : 'of assets'} />
      </div>
      <div className="grid">
        <Card className="span-7" title={`By ${dimLabel.toLowerCase()}`} sub={dim === 'sector' ? 'PSX shares and ETFs only' : dim === 'risk' ? 'Grouped by typical volatility: a rough guide' : undefined}
          actions={LOOK_DIMS.includes(dim) ? <Toggle checked={look} onChange={setLook} label="Fund look-through" /> : undefined}>
          <div className="stack" style={{ gap: 14 }}>
            <div className="qopts" role="group" aria-label="Break down by">
              {DIMS.map((d) => <Chip key={d.value} pressed={dim === d.value} onClick={() => setDim(d.value)}>{d.label}</Chip>)}
            </div>
            {rows.length ? (
              <>
                <StackBar parts={rows.map((r) => ({ key: r.key, frac: r.value / total, color: r.color, label: r.label }))} />
                <div className="row-between">
                  <div className="chart-legend">{rows.length <= 8 && rows.map((r) => <LegendItem key={r.key} color={r.color} label={r.label} />)}</div>
                  <button type="button" className="linkbtn small" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>{showTable ? 'Show bars' : 'Show table'}</button>
                </div>
                {showTable ? (
                  <div className="table-wrap">
                    <table className="t compact"><thead><tr><th>{dimLabel}</th><th className="num">Value</th><th className="num">Share</th></tr></thead>
                      <tbody>{rows.map((r) => <tr key={r.key}><td>{r.label}</td><td className="num">{fmt.money(r.value)}</td><td className="num">{fmt.pct((r.value / total) * 100, 1)}</td></tr>)}<tr className="total"><td>Total</td><td className="num">{fmt.money(total)}</td><td className="num">100%</td></tr></tbody>
                    </table>
                  </div>
                ) : (
                  <BarList rows={rows.map((r) => ({ key: r.key, label: r.label, value: fmt.money(r.value), sub: fmt.pct((r.value / total) * 100, 1), frac: r.value / total, color: r.color }))} />
                )}
              </>
            ) : (
              <p className="small muted">No holdings in this breakdown{dim === 'sector' ? ': you hold no PSX shares in this view' : ''}.</p>
            )}
          </div>
        </Card>
        <Card className="span-5 chart-card" title="Every holding, sized by value" sub="Grouped by asset class; hover for details">
          <ChartFrame
            chart={<Treemap data={tree} fmtVal={fmt.moneyC} height={380} ariaLabel="Treemap of holdings by value" />}
            table={() => (
              <table className="t compact"><thead><tr><th>Holding</th><th>Class</th><th className="num">Value</th></tr></thead>
                <tbody>{tree.flatMap((d) => d.children.map((ch) => <tr key={d.name + ch.name}><td>{ch.name}</td><td>{d.name}</td><td className="num">{fmt.money(ch.value)}</td></tr>))}</tbody>
              </table>
            )}
          />
        </Card>
        <Card className="span-12 chart-card" title="Drift from your target mix" sub={target ? `Liquid assets only (${fmt.money(mix.total)}); property and locked assets are excluded` : 'Set a target in the Optimizer to track drift'}
          actions={<Button size="sm" variant="ghost" icon="optimizer" onClick={() => go('optimizer')}>{target ? 'Change target' : 'Open optimizer'}</Button>}>
          {drift && driftChart ? (
            <div className="grid">
              <div className="span-7">
                <ChartFrame
                  legend={<><LegendItem color={colors.other} label="Today" /><LegendItem color={colors.series[2]} label="Target" /></>}
                  chart={<PairedBars labels={driftChart.labels} a={{ name: 'Today', data: driftChart.a, color: colors.other }} b={{ name: 'Target', data: driftChart.b, color: colors.series[2] }} fmtVal={fmtPctA} height={280} ariaLabel="Current mix versus target mix" />}
                />
              </div>
              <div className="span-5 stack">
                <div className="table-wrap">
                  <table className="t compact">
                    <thead><tr><th>Class</th><th className="num">Drift</th><th className="num">To rebalance</th></tr></thead>
                    <tbody>{drift.map((d) => (
                      <tr key={d.c}>
                        <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><span className="swatch" style={{ background: optColor(colors.series, d.c) }} />{OPT_LABELS[d.c]}</span></td>
                        <td className="num">{(d.cur - d.tgt > 0 ? '+' : '') + (d.cur - d.tgt).toFixed(1)} pts</td>
                        <td className={'num ' + (Math.abs(d.trade) < mix.total * 0.005 ? 'muted' : d.trade > 0 ? 'up' : 'down')}>{Math.abs(d.trade) < mix.total * 0.005 ? 'On target' : `${d.trade > 0 ? 'Buy' : 'Sell'} ${fmt.money(Math.abs(d.trade))}`}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                {maxDrift > 5 ? <Callout tone="warn">One class is more than 5 points away from target. Directing new money to the underweight classes rebalances without selling.</Callout> : <Callout tone="good">Every class is within 5 points of target.</Callout>}
              </div>
            </div>
          ) : (
            <p className="small muted">No target mix yet. The Optimizer suggests one from your risk profile and limits; once saved, this card shows how far each class has drifted and what to buy or sell.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

const fmtPctA = (v: number) => `${Math.round(v)}%`;
