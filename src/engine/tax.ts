// Pakistan tax rules used by the app: TY2027 (1 July 2026 – 30 June 2027), Finance Act 2026.
// Estimates only. Sources: KPMG TY2027 withholding rate card; ICT CGT guide; Baco Consultants.

import { fundCategory, GOVT_KINDS } from './catalog';
import { monthsBetween } from './format';
import type { Holding, Liability, MarketSnapshot } from './types';
import { costPKR, holdingClass, valuePKR } from './valuation';

export const TAX_YEAR = 'TY2027';
export const TAX_PERIOD = 'July 2026 to June 2027';

export const TAX = {
  dividend: 0.15,
  fundDebtDividend: 0.25,
  bankProfit: 0.2,
  nssProfit: 0.15,
  govtProfit: 0.15,
  sukukProfit: 0.125,
  npcProfit: 0.1,
  usDividendWht: 0.3,
  cgtListed: 0.15,
  cgtFund: 0.15,
  cgtProperty: 0.15,
  sellerAdvance: 0.0275,
  sellerAdvanceNonFiler: 0.115,
  buyerAdvance: 0.0125,
  zakatRate: 0.025,
  nisabSilverTola: 52.5,
  nisabGoldTola: 7.5,
};

/** Rent tax (section 155) for individuals, on gross yearly rent in PKR. */
export function rentTax(annualGross: number): number {
  const r = Math.max(0, annualGross);
  if (r <= 300_000) return 0;
  if (r <= 600_000) return (r - 300_000) * 0.05;
  if (r <= 2_000_000) return 15_000 + (r - 600_000) * 0.1;
  return 155_000 + (r - 2_000_000) * 0.25;
}

export function buyerAdvanceRate(fmv: number, filer: boolean): number {
  if (filer) return TAX.buyerAdvance;
  if (fmv <= 50_000_000) return 0.105;
  if (fmv <= 100_000_000) return 0.145;
  return 0.185;
}

export function sellerAdvanceRate(filer: boolean): number {
  return filer ? TAX.sellerAdvance : TAX.sellerAdvanceNonFiler;
}

/** Tax rate applied to the cash income of a holding (fraction). Property rent uses slabs instead. */
export function incomeTaxRate(h: Holding, filer: boolean): number {
  const k = filer ? 1 : 2;
  switch (h.type) {
    case 'psx_stock':
    case 'psx_etf':
      return TAX.dividend * k;
    case 'mutual_fund':
    case 'vps': {
      const c = fundCategory(h.type, h.sub);
      const eq = c.mix.eq + c.mix.gold + c.mix.global;
      return (eq * TAX.dividend + (1 - eq) * TAX.fundDebtDividend) * k;
    }
    case 'nss':
      return TAX.nssProfit * k;
    case 'govt_sec': {
      const g = GOVT_KINDS.find((x) => x.key === h.sub);
      return (g?.key === 'gis' ? TAX.sukukProfit : TAX.govtProfit) * k;
    }
    case 'deposit':
      return TAX.bankProfit * k;
    case 'fx_cash':
      return h.sub === 'npc' || h.sub === 'npc_islamic' ? TAX.npcProfit : TAX.bankProfit * k;
    case 'global_stock':
    case 'global_etf':
    case 'global_bond':
      return TAX.usDividendWht;
    default:
      return 0;
  }
}

/** Sliding CGT rate for shares bought 1 Jul 2022 – 30 Jun 2024, by years held. */
function slidingRate(yearsHeld: number): number {
  if (yearsHeld < 1) return 0.15;
  if (yearsHeld < 2) return 0.125;
  if (yearsHeld < 3) return 0.1;
  if (yearsHeld < 4) return 0.075;
  if (yearsHeld < 5) return 0.05;
  if (yearsHeld < 6) return 0.025;
  return 0;
}

/** Older property regime (bought before 1 Jul 2024): rate falls to zero with holding period. */
function oldPropertyRate(kind: string | undefined, yearsHeld: number): number {
  const plot = !kind || kind.includes('plot') || kind === 'agricultural' || kind === 'file';
  const flat = kind === 'apartment';
  const zeroAfter = plot ? 6 : flat ? 2 : 4;
  if (yearsHeld >= zeroAfter) return 0;
  return 0.15 * (1 - yearsHeld / zeroAfter);
}

/** Estimated CGT rate if the holding were sold on `today` (fraction of the gain). */
export function cgtRate(h: Holding, filer: boolean, today: string, foreignRate: number): number {
  const bought = h.purchaseDate;
  const yearsHeld = bought ? monthsBetween(bought, today) / 12 : 0;
  const newRegime = !bought || bought >= '2024-07-01';
  const nf = filer ? 1 : 2;
  switch (h.type) {
    case 'psx_stock':
    case 'psx_etf': {
      if (newRegime) return TAX.cgtListed * nf;
      if (bought! < '2013-07-01') return 0;
      if (bought! < '2022-07-01') return 0.125 * nf;
      return slidingRate(yearsHeld) * nf;
    }
    case 'mutual_fund': {
      if (newRegime) return TAX.cgtFund * nf;
      return yearsHeld > 6 ? 0 : 0.125 * nf;
    }
    case 'property': {
      if (newRegime) return TAX.cgtProperty * nf;
      return oldPropertyRate(h.sub, yearsHeld) * nf;
    }
    case 'global_stock':
    case 'global_etf':
    case 'global_bond':
      return foreignRate / 100;
    default:
      return 0;
  }
}

export interface CgtLine {
  id: string;
  name: string;
  value: number;
  cost: number;
  gain: number;
  rate: number;
  tax: number;
}

export function cgtIfSoldToday(holdings: Holding[], m: MarketSnapshot, filer: boolean, today: string, foreignRate: number): { lines: CgtLine[]; total: number; gains: number } {
  const lines: CgtLine[] = [];
  let total = 0, gains = 0;
  for (const h of holdings) {
    const c = costPKR(h, m);
    if (c === undefined) continue;
    const v = valuePKR(h, m);
    const gain = v - c;
    const rate = cgtRate(h, filer, today, foreignRate);
    const tax = gain > 0 ? gain * rate : 0;
    if (rate === 0 && gain <= 0) continue;
    lines.push({ id: h.id, name: h.ticker ? `${h.name} (${h.ticker})` : h.name, value: v, cost: c, gain, rate, tax });
    total += tax;
    if (gain > 0) gains += gain;
  }
  lines.sort((a, b) => b.tax - a.tax);
  return { lines, total, gains };
}

// ---------- Zakat ----------

export type ZakatGroup = 'cash' | 'savings' | 'metals' | 'equities' | 'funds' | 'global' | 'crypto' | 'property_trade' | 'pension' | 'business';

export const ZAKAT_GROUPS: { key: ZakatGroup; label: string; defaultOn: boolean; note: string }[] = [
  { key: 'cash', label: 'Cash and bank deposits', defaultOn: true, note: 'Including foreign currency' },
  { key: 'savings', label: 'NSS and government securities', defaultOn: true, note: 'Principal value' },
  { key: 'metals', label: 'Gold and silver', defaultOn: true, note: 'At market value' },
  { key: 'equities', label: 'PSX shares and ETFs', defaultOn: true, note: 'Market value; some scholars use the zakatable-asset ratio' },
  { key: 'funds', label: 'Mutual funds', defaultOn: true, note: 'Market value' },
  { key: 'global', label: 'Global stocks and bonds', defaultOn: true, note: 'Market value' },
  { key: 'crypto', label: 'Crypto', defaultOn: true, note: 'Market value' },
  { key: 'property_trade', label: 'Property held for resale', defaultOn: true, note: 'Your home and rented property are excluded' },
  { key: 'pension', label: 'VPS and provident fund', defaultOn: false, note: 'Often excluded until accessible' },
  { key: 'business', label: 'Business stakes', defaultOn: false, note: 'Depends on the business assets' },
];

export function zakatGroupOf(h: Holding): ZakatGroup | null {
  switch (h.type) {
    case 'cash':
    case 'deposit':
    case 'fx_cash':
      return 'cash';
    case 'nss':
    case 'govt_sec':
      return 'savings';
    case 'gold':
    case 'silver':
      return 'metals';
    case 'psx_stock':
    case 'psx_etf':
      return 'equities';
    case 'mutual_fund':
      return 'funds';
    case 'global_stock':
    case 'global_etf':
    case 'global_bond':
      return 'global';
    case 'crypto':
      return 'crypto';
    case 'property':
      return h.propertyUse === 'investment' ? 'property_trade' : null;
    case 'vps':
    case 'retirement':
      return 'pension';
    case 'business':
      return 'business';
    default:
      return null;
  }
}

/** Default zakatable fraction used inside simulations. */
export function zakatableFraction(h: Holding): number {
  const g = zakatGroupOf(h);
  if (!g) return 0;
  return ZAKAT_GROUPS.find((z) => z.key === g)?.defaultOn ? 1 : 0;
}

export function nisabPKR(m: MarketSnapshot, basis: 'silver' | 'gold'): number {
  return basis === 'gold' ? TAX.nisabGoldTola * m.goldTola : TAX.nisabSilverTola * m.silverTola;
}

export interface ZakatResult {
  byGroup: { key: ZakatGroup; label: string; value: number; included: boolean }[];
  gross: number;
  deductions: number;
  base: number;
  nisab: number;
  due: number;
  aboveNisab: boolean;
}

export function computeZakat(
  holdings: Holding[], liabilities: Liability[], m: MarketSnapshot, basis: 'silver' | 'gold',
  included: Partial<Record<ZakatGroup, boolean>>, deductDebts: boolean,
): ZakatResult {
  const values: Record<string, number> = {};
  for (const h of holdings) {
    const g = zakatGroupOf(h);
    if (!g) continue;
    values[g] = (values[g] ?? 0) + valuePKR(h, m);
  }
  const byGroup = ZAKAT_GROUPS.map((z) => ({
    key: z.key,
    label: z.label,
    value: values[z.key] ?? 0,
    included: included[z.key] ?? z.defaultOn,
  }));
  const gross = byGroup.reduce((s, g) => s + (g.included ? g.value : 0), 0);
  // Debts due within 12 months: card balances + 12 instalments of other loans, capped at balance.
  const deductions = deductDebts
    ? liabilities.reduce((s, l) => {
        const bal = (l.balance || 0) * (m.fx[l.currency] ?? 1);
        if (l.type === 'card') return s + bal;
        return s + Math.min(bal, (l.payment || 0) * 12 * (m.fx[l.currency] ?? 1));
      }, 0)
    : 0;
  const base = Math.max(0, gross - deductions);
  const nisab = nisabPKR(m, basis);
  const aboveNisab = base >= nisab;
  return { byGroup, gross, deductions, base, nisab, due: aboveNisab ? base * TAX.zakatRate : 0, aboveNisab };
}

export interface IncomeTaxLine {
  key: string;
  label: string;
  gross: number;
  tax: number;
  net: number;
  rateNote: string;
}

/** Estimated yearly tax on portfolio income, grouped by income type. */
export function incomeTaxSummary(
  holdings: Holding[], m: MarketSnapshot, filer: boolean,
  incomeOf: (h: Holding) => number, grossRentOf: (h: Holding) => number,
): { lines: IncomeTaxLine[]; total: number; gross: number } {
  const groups: Record<string, IncomeTaxLine> = {};
  const add = (key: string, label: string, gross: number, tax: number, rateNote: string) => {
    const g = (groups[key] ??= { key, label, gross: 0, tax: 0, net: 0, rateNote });
    g.gross += gross;
    g.tax += tax;
    g.net = g.gross - g.tax;
  };
  const k = filer ? 1 : 2;
  let rentGross = 0;
  for (const h of holdings) {
    if (h.type === 'property') {
      rentGross += grossRentOf(h);
      continue;
    }
    const inc = incomeOf(h);
    if (inc <= 0) continue;
    const rate = incomeTaxRate(h, filer);
    const cls = holdingClass(h);
    if (h.type === 'psx_stock' || h.type === 'psx_etf') add('div', 'PSX dividends', inc, inc * rate, `${(TAX.dividend * k * 100).toFixed(0)}%`);
    else if (h.type === 'mutual_fund' || h.type === 'vps') add('fund', 'Fund distributions', inc, inc * rate, `${(TAX.dividend * k * 100).toFixed(0)}% to ${(TAX.fundDebtDividend * k * 100).toFixed(0)}%`);
    else if (h.type === 'nss') add('nss', 'National Savings profit', inc, inc * rate, `${(TAX.nssProfit * k * 100).toFixed(0)}%`);
    else if (h.type === 'govt_sec') add('govt', 'Government securities profit', inc, inc * rate, `${(TAX.govtProfit * k * 100).toFixed(1).replace('.0', '')}%`);
    else if (h.type === 'deposit') add('bank', 'Bank deposit profit', inc, inc * rate, `${(TAX.bankProfit * k * 100).toFixed(0)}%`);
    else if (h.type === 'fx_cash') add('fx', 'Foreign currency profit', inc, inc * rate, 'NPC 10%; deposits ' + `${(TAX.bankProfit * k * 100).toFixed(0)}%`);
    else if (cls === 'global') add('foreign', 'Foreign dividends (US withholding)', inc, inc * rate, '30%');
    else add('other', 'Other income', inc, 0, 'not estimated');
  }
  if (rentGross > 0) {
    const t = rentTax(rentGross);
    add('rent', 'Rent', rentGross, t, 'slabs: 0% to 25%');
  }
  const lines = Object.values(groups).sort((a, b) => b.gross - a.gross);
  const total = lines.reduce((s, l) => s + l.tax, 0);
  const gross = lines.reduce((s, l) => s + l.gross, 0);
  return { lines, total, gross };
}
