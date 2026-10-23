// Current passive income by holding and a 12-month payout calendar.

import { MONTH_NAMES, monthsBetween } from './format';
import { incomeTaxRate, rentTax } from './tax';
import type { AssetClass, Holding, MarketSnapshot, Payout } from './types';
import { annualIncomePKR, grossRentPKR, holdingClass, payoutOf } from './valuation';

export type IncomeSource = 'dividends' | 'funds' | 'profit' | 'rent' | 'foreign' | 'other';

export const SOURCE_LABELS: Record<IncomeSource, string> = {
  dividends: 'PSX dividends',
  funds: 'Fund payouts',
  profit: 'Profit and interest',
  rent: 'Rent',
  foreign: 'Foreign dividends',
  other: 'Other',
};

export const SOURCE_ORDER: IncomeSource[] = ['profit', 'dividends', 'rent', 'funds', 'foreign', 'other'];

export interface IncomeLine {
  id: string;
  name: string;
  cls: AssetClass;
  source: IncomeSource;
  gross: number;
  tax: number;
  net: number;
  payout: Payout;
  /** Net amount by month for the next 12 months (index 0 = next month). */
  schedule: number[];
}

function sourceOf(h: Holding): IncomeSource {
  switch (h.type) {
    case 'psx_stock':
    case 'psx_etf':
      return 'dividends';
    case 'mutual_fund':
    case 'vps':
      return 'funds';
    case 'nss':
    case 'govt_sec':
    case 'deposit':
    case 'fx_cash':
      return 'profit';
    case 'property':
      return 'rent';
    case 'global_stock':
    case 'global_etf':
    case 'global_bond':
      return 'foreign';
    default:
      return 'other';
  }
}

/** Calendar months (1–12) in which a payout frequency pays. */
function payMonths(p: Payout): number[] {
  switch (p) {
    case 'monthly':
      return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    case 'quarterly':
      return [3, 6, 9, 12];
    case 'semiannual':
      return [3, 9];
    case 'annual':
      return [7];
    default:
      return [];
  }
}

export function nextMonths(today: string, n = 12): { y: number; m: number; label: string }[] {
  const t = /^(\d{4})-(\d{2})/.exec(today)!;
  let y = Number(t[1]);
  let mo = Number(t[2]);
  const out: { y: number; m: number; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
    out.push({ y, m: mo, label: `${MONTH_NAMES[mo - 1]} ${String(y).slice(2)}` });
  }
  return out;
}

export function incomeLines(holdings: Holding[], m: MarketSnapshot, filer: boolean, today: string): IncomeLine[] {
  const months = nextMonths(today);
  const totalGrossRent = holdings.reduce((s, h) => s + grossRentPKR(h, m), 0);
  const rentTaxTotal = rentTax(totalGrossRent);
  const lines: IncomeLine[] = [];
  for (const h of holdings) {
    const gross = annualIncomePKR(h, m);
    if (gross <= 0) continue;
    let tax: number;
    if (h.type === 'property') {
      const gr = grossRentPKR(h, m);
      tax = totalGrossRent > 0 ? (rentTaxTotal * gr) / totalGrossRent : 0;
    } else tax = gross * incomeTaxRate(h, filer);
    const net = gross - tax;
    const payout = payoutOf(h);
    const schedule = new Array(12).fill(0);
    if (payout === 'maturity') {
      if (h.maturity) {
        const k = monthsBetween(today, h.maturity) - 1;
        if (k >= 0 && k < 12) schedule[k] = net;
      }
    } else {
      const pm = payMonths(payout);
      if (pm.length) months.forEach((mm, i) => {
        if (pm.includes(mm.m)) schedule[i] = net / pm.length;
      });
    }
    lines.push({
      id: h.id,
      name: h.ticker ? `${h.name} (${h.ticker})` : h.name,
      cls: holdingClass(h),
      source: sourceOf(h),
      gross,
      tax,
      net,
      payout,
      schedule,
    });
  }
  lines.sort((a, b) => b.gross - a.gross);
  return lines;
}

export function calendarBySource(lines: IncomeLine[]): Record<IncomeSource, number[]> {
  const out = Object.fromEntries(SOURCE_ORDER.map((s) => [s, new Array(12).fill(0)])) as Record<IncomeSource, number[]>;
  for (const l of lines) for (let i = 0; i < 12; i++) out[l.source][i] += l.schedule[i];
  return out;
}
