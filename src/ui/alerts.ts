// Rule-based portfolio checks shown on the Overview.

import { CLASS_META } from '../engine/catalog';
import type { RiskReport } from '../engine/risk';
import type { SimResult } from '../engine/simtypes';
import { incomeTaxRate } from '../engine/tax';
import type { Holding, MarketSnapshot, Portfolio, Settings } from '../engine/types';
import type { Totals } from '../engine/valuation';
import { annualIncomePKR, holdingClass, liquidityOf, priceAgeDays, rateOf, sectorOf, valuePKR } from '../engine/valuation';
import type { View } from '../state/store';

const EMERGENCY_FUNDS = ['money_market', 'islamic_mm', 'income', 'islamic_income'];

/** Money reachable within days without market risk: cash, deposits, FX cash, money market and income funds. */
export function emergencyAssets(holdings: Holding[], m: MarketSnapshot): number {
  return holdings
    .filter((h) => ['instant', 'days'].includes(liquidityOf(h)) && (h.type === 'cash' || h.type === 'deposit' || h.type === 'fx_cash' || (h.type === 'mutual_fund' && EMERGENCY_FUNDS.includes(h.sub ?? ''))))
    .reduce((s, h) => s + valuePKR(h, m), 0);
}

export interface Alert {
  key: string;
  tone: 'good' | 'warn' | 'serious' | 'critical' | 'neutral';
  title: string;
  body: string;
  view?: View;
}

export function computeAlerts(
  p: Portfolio, holdings: Holding[], t: Totals, m: MarketSnapshot, s: Settings, today: string,
  money: (v: number) => string, forecast?: SimResult, risk?: RiskReport,
): Alert[] {
  const out: Alert[] = [];
  if (!holdings.length) return out;
  const A = t.assets || 1;
  const vals = holdings.map((h) => ({ h, v: valuePKR(h, m) })).sort((a, b) => b.v - a.v);
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  // Goals at risk
  if (forecast) {
    for (const g of forecast.goals) {
      const goal = p.goals.find((x) => x.id === g.id);
      if (!goal) continue;
      if (g.prob < 0.5) out.push({ key: 'goal-' + g.id, tone: 'critical', title: `${goal.name} is at risk`, body: `Only a ${pct(g.prob)} chance of being fully funded on time at the current plan.`, view: 'goals' });
      else if (g.prob < 0.8) out.push({ key: 'goal-' + g.id, tone: 'warn', title: `${goal.name} needs attention`, body: `A ${pct(g.prob)} chance of being funded on time. Small changes to your SIP can lift it.`, view: 'goals' });
    }
  }

  // Property concentration and illiquidity
  const re = t.byClass.realestate / A;
  const illiquid = vals.filter(({ h }) => ['months', 'locked'].includes(liquidityOf(h))).reduce((x, y) => x + y.v, 0) / A;
  if (illiquid > 0.6) out.push({ key: 'illiquid', tone: 'warn', title: `${pct(illiquid)} of your wealth takes months to sell`, body: re > 0.4 ? `Property alone is ${pct(re)} of assets. Keep enough in liquid assets for goals and emergencies.` : 'Keep enough in liquid assets for goals and emergencies.', view: 'risk' });

  // Single holding concentration (financial assets)
  const fin = vals.filter(({ h }) => holdingClass(h) !== 'realestate');
  const top = fin[0];
  if (top && top.v / A > 0.25 && holdingClass(top.h) !== 'fixed') out.push({ key: 'conc', tone: 'warn', title: `${top.h.ticker ?? top.h.name} is ${pct(top.v / A)} of your assets`, body: 'A single position this large can dominate your results. Consider trimming or diversifying.', view: 'risk' });
  const stocks = vals.filter(({ h }) => h.type === 'psx_stock');
  const bigStock = stocks.find((x) => x.v / A > 0.1);
  if (bigStock && bigStock !== top) out.push({ key: 'stock', tone: 'warn', title: `${bigStock.h.ticker} is ${pct(bigStock.v / A)} of your assets`, body: 'More than 10% in one listed company adds company-specific risk.', view: 'risk' });
  const psxTotal = stocks.reduce((x, y) => x + y.v, 0);
  if (psxTotal > 0 && stocks.length >= 3) {
    const bySec: Record<string, number> = {};
    stocks.forEach(({ h, v }) => (bySec[sectorOf(h)] = (bySec[sectorOf(h)] ?? 0) + v));
    const [sec, sv] = Object.entries(bySec).sort((a, b) => b[1] - a[1])[0];
    if (sv / psxTotal > 0.4) out.push({ key: 'sector', tone: 'warn', title: `${sec} is ${pct(sv / psxTotal)} of your PSX stocks`, body: 'Sector concentration makes your stock portfolio swing with one industry.', view: 'allocation' });
  }

  // Rupee exposure
  if (t.hardCurrency < 0.1) out.push({ key: 'fx', tone: 'warn', title: `Only ${pct(t.hardCurrency)} of your wealth is protected from rupee depreciation`, body: 'USD/PKR rose about 8% a year from 2005 to 2025. Gold, foreign currency and global assets hedge that risk.', view: 'optimizer' });

  // Idle cash and below-inflation savings
  const idle = vals.filter(({ h }) => h.type === 'cash' || (h.type === 'deposit' && rateOf(h, m) <= 0)).reduce((x, y) => x + y.v, 0);
  if (idle > 500_000 || idle / A > 0.05) out.push({ key: 'idle', tone: 'warn', title: `${money(idle)} is earning nothing`, body: `With inflation at ${m.cpi.toFixed(1)}%, idle cash loses about ${money(idle * m.cpi / 100)} of buying power a year. A money market fund pays close to the T-bill rate.`, view: 'holdings' });
  const belowInfl = vals.filter(({ h }) => (h.type === 'deposit' || h.type === 'nss') && rateOf(h, m) > 0 && rateOf(h, m) * (1 - incomeTaxRate(h, s.filer)) < m.cpi);
  if (belowInfl.length) {
    const v = belowInfl.reduce((x, y) => x + y.v, 0);
    out.push({ key: 'real', tone: 'neutral', title: `${money(v)} earns less than inflation after tax`, body: `${belowInfl.map((x) => x.h.name).slice(0, 3).join(', ')} ${belowInfl.length > 3 ? 'and others ' : ''}pay below ${m.cpi.toFixed(1)}% after withholding tax, so their real value shrinks.`, view: 'income' });
  }

  // Emergency fund
  const instant = emergencyAssets(holdings, m);
  if (s.monthlyExpenses > 0 && instant < s.monthlyExpenses * 6) out.push({ key: 'emergency', tone: 'warn', title: 'Your emergency buffer is thin', body: `Cash, deposits and money market funds cover ${(instant / s.monthlyExpenses).toFixed(1)} months of expenses. Six months is a common target.`, view: 'goals' });

  // Crypto weight
  const cr = t.byClass.crypto / A;
  if (cr > 0.1) out.push({ key: 'crypto', tone: 'warn', title: `Crypto is ${pct(cr)} of your assets`, body: 'Crypto can fall 75% in a year. Most planners keep it under 5 to 10%.', view: 'stress' });

  // Non-filer
  if (!s.filer) {
    const income = holdings.reduce((x, h) => x + annualIncomePKR(h, m), 0);
    out.push({ key: 'filer', tone: 'critical', title: 'Non-filer rates roughly double your tax', body: `Non-filers pay 30% on dividends and 40% on bank profit. Filing could save about ${money(income * 0.12)} a year on this portfolio.`, view: 'tax' });
  }

  // Stale prices
  const stale = holdings.filter((h) => {
    const d = priceAgeDays(h, today);
    return d !== undefined && d > 30 && ['psx', 'funds', 'global', 'crypto'].includes(holdingClass(h));
  });
  if (stale.length && !p.isExample) out.push({ key: 'stale', tone: 'neutral', title: `${stale.length} prices are more than 30 days old`, body: 'Update prices so valuations and forecasts start from today.', view: 'holdings' });

  // Risk
  if (risk && risk.var95 > 0.2) out.push({ key: 'var', tone: 'serious', title: `A bad year could cost ${pct(risk.var95)} or more`, body: `In 1 of 20 simulated years the portfolio loses at least ${money(risk.var95 * risk.total)}.`, view: 'risk' });

  // Checks that passed, so the list also says what is in good shape.
  const good: Alert[] = [];
  if (forecast && forecast.goals.length && forecast.goals.every((g) => g.prob >= 0.8)) good.push({ key: 'g-goals', tone: 'good', title: `All ${forecast.goals.length} goals are on track`, body: 'Each has at least an 80% chance of being fully funded on time.', view: 'goals' });
  if (t.hardCurrency >= 0.2) good.push({ key: 'g-fx', tone: 'good', title: `${pct(t.hardCurrency)} of your wealth is hedged against the rupee`, body: 'Gold, foreign currency, global and crypto holdings rise in rupee terms when the rupee falls.' });
  if (s.monthlyExpenses > 0 && instant >= s.monthlyExpenses * 6) good.push({ key: 'g-em', tone: 'good', title: `Emergency buffer covers ${(instant / s.monthlyExpenses).toFixed(0)} months`, body: 'Cash, deposits and money market funds cover at least six months of expenses.' });
  if (risk && risk.var95 <= 0.1) {
    const body = risk.var95 > 0
      ? `Only 1 simulated year in 20 loses more than ${(risk.var95 * 100).toFixed(1)}% (${money(risk.var95 * risk.total)}).`
      : 'Even the worst 1 in 20 simulated years ends with a small gain.';
    good.push({ key: 'g-var', tone: 'good', title: 'A bad year looks manageable', body, view: 'risk' });
  }
  if (s.filer) good.push({ key: 'g-filer', tone: 'good', title: 'Filer tax rates apply', body: 'Withholding on dividends and profit is half the non-filer rate.', view: 'tax' });
  if (!out.length) out.push({ key: 'ok', tone: 'good', title: 'No red flags found', body: 'Concentration, liquidity, currency exposure and goals all look reasonable on these checks.' });
  const rank = { critical: 0, serious: 1, warn: 2, neutral: 3, good: 4 };
  const sorted = out.sort((a, b) => rank[a.tone] - rank[b.tone]);
  return [...sorted, ...good.slice(0, Math.max(2, 6 - sorted.length))];
}

export function classShareLabel(c: keyof typeof CLASS_META): string {
  return CLASS_META[c].label;
}
