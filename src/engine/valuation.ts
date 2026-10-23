// Valuation, classification and aggregation of holdings.

import {
  CLASS_META, CRYPTO_KINDS, DEPOSIT_KINDS, FUND_CATEGORIES, FX_KINDS, GLOBAL_TICKERS, GOVT_KINDS, NSS_PRODUCTS,
  OZ_GRAMS, PROPERTY_KINDS, PSX_ETFS, PSX_SECTORS, PSX_TICKERS, TOLA_GRAMS, TYPE_META, VPS_SCHEMES, fundCategory, nssProduct,
} from './catalog';
import type {
  AssetClass, Currency, Filters, Holding, Liability, Liquidity, MarketSnapshot, Payout, Shariah,
} from './types';
import { CLASS_ORDER } from './types';
import { cryptoUsd } from './feed';

export function holdingClass(h: Holding): AssetClass {
  return TYPE_META[h.type]?.cls ?? 'other';
}

export function fxRate(c: Currency, m: MarketSnapshot): number {
  return m.fx[c] ?? 1;
}

/** Quantity expressed in the unit the price refers to (tola of 24k for metals). */
export function effectiveQty(h: Holding): number {
  const q = Number(h.qty) || 0;
  if (h.type === 'gold' || h.type === 'silver') {
    let tola = q;
    if (h.unit === 'gram') tola = q / TOLA_GRAMS;
    else if (h.unit === 'oz') tola = (q * OZ_GRAMS) / TOLA_GRAMS;
    const purity = h.type === 'gold' ? (h.karat ?? 24) / 24 : 1;
    return tola * purity;
  }
  return q;
}

export function unitPrice(h: Holding, m: MarketSnapshot): number {
  if (h.useMarketPrice) {
    if (h.type === 'gold') return m.goldTola;
    if (h.type === 'silver') return m.silverTola;
    if (h.type === 'crypto') {
      const usd = cryptoUsd(m, h.ticker);
      if (usd !== undefined) return h.currency === 'USD' ? usd : (usd * m.fx.USD) / (m.fx[h.currency] || 1);
    }
  }
  return Number(h.price) || 0;
}

export function valueLocal(h: Holding, m: MarketSnapshot): number {
  return effectiveQty(h) * unitPrice(h, m);
}

export function valuePKR(h: Holding, m: MarketSnapshot): number {
  return valueLocal(h, m) * fxRate(h.currency, m);
}

export function costPKR(h: Holding, m: MarketSnapshot): number | undefined {
  if (h.avgCost === undefined || h.avgCost === null || !isFinite(h.avgCost)) return undefined;
  return effectiveQty(h) * h.avgCost * fxRate(h.currency, m);
}

export function liabilityPKR(l: Liability, m: MarketSnapshot): number {
  return (Number(l.balance) || 0) * fxRate(l.currency, m);
}

export function shariahOf(h: Holding): Shariah {
  if (h.shariah) return h.shariah;
  switch (h.type) {
    case 'psx_stock':
      return PSX_TICKERS.find((t) => t.ticker === h.ticker)?.shariah ?? 'unknown';
    case 'psx_etf':
      return PSX_ETFS.find((t) => t.ticker === h.ticker)?.shariah ?? 'unknown';
    case 'mutual_fund':
    case 'vps':
      return fundCategory(h.type, h.sub).shariah;
    case 'nss':
      return nssProduct(h.sub).shariah;
    case 'deposit':
      return DEPOSIT_KINDS.find((d) => d.key === h.sub)?.shariah ?? 'no';
    case 'govt_sec':
      return GOVT_KINDS.find((d) => d.key === h.sub)?.shariah ?? 'no';
    case 'fx_cash':
      return FX_KINDS.find((d) => d.key === h.sub)?.shariah ?? 'no';
    default:
      return TYPE_META[h.type]?.shariah ?? 'unknown';
  }
}

export function liquidityOf(h: Holding): Liquidity {
  if (h.liquidity) return h.liquidity;
  if (h.type === 'deposit' && (h.sub === 'tdr' || h.sub === 'islamic_tdr')) return 'weeks';
  if (h.type === 'fx_cash' && (h.sub === 'npc' || h.sub === 'npc_islamic')) return 'weeks';
  if (h.type === 'nss' && h.sub === 'SISA') return 'days';
  if (h.type === 'govt_sec' && h.sub === 'tfc') return 'weeks';
  return TYPE_META[h.type]?.liquidity ?? 'months';
}

export function isLiquid(h: Holding): boolean {
  const l = liquidityOf(h);
  return l === 'instant' || l === 'days' || l === 'weeks';
}

/** Can receive new contributions and be rebalanced. */
export function isInvestable(h: Holding): boolean {
  const l = liquidityOf(h);
  if (h.type === 'vps') return true; // contributions allowed even though locked
  return l !== 'months' && l !== 'locked' && h.type !== 'cash';
}

export function sectorDefaults(sector?: string) {
  return PSX_SECTORS[sector ?? 'Other'] ?? PSX_SECTORS.Other;
}

export function globalTicker(ticker?: string) {
  if (!ticker) return undefined;
  return GLOBAL_TICKERS.find((t) => t.ticker === ticker.toUpperCase());
}

export function cryptoKind(h: Holding) {
  const key = h.sub ?? (['USDT', 'USDC'].includes((h.ticker ?? '').toUpperCase()) ? 'stable' : (h.ticker ?? '').toUpperCase() === 'BTC' ? 'btc' : (h.ticker ?? '').toUpperCase() === 'ETH' ? 'eth' : 'alt');
  return CRYPTO_KINDS.find((k) => k.key === key) ?? CRYPTO_KINDS[2];
}

/** Default profit or coupon rate for rate-based holdings (% p.a.). */
export function defaultRate(h: Holding, m: MarketSnapshot): number {
  switch (h.type) {
    case 'nss':
      return m.nss[h.sub ?? 'RIC'] ?? 11.5;
    case 'deposit':
      return DEPOSIT_KINDS.find((d) => d.key === h.sub)?.rate ?? 10;
    case 'govt_sec':
      return GOVT_KINDS.find((d) => d.key === h.sub)?.rate ?? m.tbill.m12;
    case 'fx_cash':
      if (h.sub === 'npc') return m.npcUsd;
      return FX_KINDS.find((d) => d.key === h.sub)?.rate ?? 0;
    default:
      return 0;
  }
}

export function rateOf(h: Holding, m: MarketSnapshot): number {
  return h.rate !== undefined && h.rate !== null && isFinite(h.rate) ? h.rate : defaultRate(h, m);
}

export function payoutOf(h: Holding): Payout {
  if (h.payout) return h.payout;
  switch (h.type) {
    case 'psx_stock':
    case 'psx_etf':
      return 'semiannual';
    case 'mutual_fund':
    case 'vps':
      return 'none';
    case 'nss':
      return nssProduct(h.sub).payout;
    case 'deposit':
      return DEPOSIT_KINDS.find((d) => d.key === h.sub)?.payout ?? 'monthly';
    case 'govt_sec':
      return GOVT_KINDS.find((d) => d.key === h.sub)?.payout ?? 'semiannual';
    case 'fx_cash':
      return h.sub === 'npc' || h.sub === 'npc_islamic' ? 'maturity' : 'monthly';
    case 'property':
      return 'monthly';
    case 'global_stock':
    case 'global_etf':
    case 'global_bond':
      return 'quarterly';
    default:
      return 'none';
  }
}

/** Gross yearly cash income as a % of value. Property: net of vacancy and costs. */
export function incomeYieldPct(h: Holding, m: MarketSnapshot): number {
  const v = valuePKR(h, m);
  switch (h.type) {
    case 'psx_stock':
      return h.yieldPct ?? sectorDefaults(PSX_TICKERS.find((t) => t.ticker === h.ticker)?.sector ?? h.sector).dy;
    case 'psx_etf':
      return h.yieldPct ?? PSX_SECTORS.ETF.dy;
    case 'mutual_fund':
    case 'vps': {
      if (payoutOf(h) === 'none') return 0;
      if (h.yieldPct !== undefined) return h.yieldPct;
      const c = fundCategory(h.type, h.sub);
      return Math.max(0, c.mix.eq * 5 + (c.mix.income + c.mix.cash) * (m.tbill.m12 - c.ter));
    }
    case 'nss':
      return h.sub === 'PRIZE' ? (h.yieldPct ?? 0) : rateOf(h, m);
    case 'govt_sec':
    case 'deposit':
    case 'fx_cash':
      return rateOf(h, m);
    case 'property': {
      if (v <= 0) return 0;
      const rent = (h.rentMonthly ?? 0) * 12 * (1 - (h.vacancyPct ?? 0) / 100) - (h.costsAnnual ?? 0);
      return (rent / v) * 100;
    }
    case 'global_stock':
    case 'global_etf':
      return h.yieldPct ?? globalTicker(h.ticker)?.dy ?? 1.5;
    case 'global_bond':
      return h.yieldPct ?? globalTicker(h.ticker)?.dy ?? 4.0;
    default:
      return h.yieldPct ?? 0;
  }
}

export function annualIncomePKR(h: Holding, m: MarketSnapshot): number {
  if (h.type === 'property') {
    const rent = (h.rentMonthly ?? 0) * 12 * (1 - (h.vacancyPct ?? 0) / 100) - (h.costsAnnual ?? 0);
    return rent * fxRate(h.currency, m);
  }
  return (valuePKR(h, m) * incomeYieldPct(h, m)) / 100;
}

export function grossRentPKR(h: Holding, m: MarketSnapshot): number {
  if (h.type !== 'property') return 0;
  return (h.rentMonthly ?? 0) * 12 * (1 - (h.vacancyPct ?? 0) / 100) * fxRate(h.currency, m);
}

/** Share of a holding's value that moves with hard currencies (USD-linked). */
export function hardCurrencyShare(h: Holding): number {
  if (h.currency !== 'PKR') return 1;
  if (h.type === 'gold' || h.type === 'silver') return 1;
  if (h.type === 'mutual_fund' || h.type === 'vps') {
    const c = fundCategory(h.type, h.sub);
    return c.mix.gold + c.mix.global;
  }
  return 0;
}

export function geographyOf(h: Holding): 'Pakistan' | 'International' {
  if (h.type === 'global_stock' || h.type === 'global_etf' || h.type === 'global_bond' || h.type === 'crypto') return 'International';
  if (h.type === 'mutual_fund' && h.sub === 'global_fund') return 'International';
  return 'Pakistan';
}

export function subLabel(h: Holding): string {
  switch (h.type) {
    case 'mutual_fund':
      return FUND_CATEGORIES.find((c) => c.key === h.sub)?.label ?? 'Mutual fund';
    case 'vps':
      return VPS_SCHEMES.find((c) => c.key === h.sub)?.label ?? 'VPS';
    case 'nss':
      return NSS_PRODUCTS.find((c) => c.key === h.sub)?.label ?? 'National Savings';
    case 'deposit':
      return DEPOSIT_KINDS.find((c) => c.key === h.sub)?.label ?? 'Deposit';
    case 'govt_sec':
      return GOVT_KINDS.find((c) => c.key === h.sub)?.label ?? 'Government security';
    case 'fx_cash':
      return (FX_KINDS.find((c) => c.key === h.sub)?.label ?? 'Foreign currency') + ` (${h.currency})`;
    case 'psx_stock':
      return h.sector ?? PSX_TICKERS.find((t) => t.ticker === h.ticker)?.sector ?? 'PSX stock';
    case 'property':
      return [PROPERTY_KINDS.find((k) => k.key === h.sub)?.label ?? (h.sub ? h.sub.replace(/_/g, ' ') : 'Property'), h.city].filter(Boolean).join(', ');
    case 'crypto':
      return cryptoKind(h).label;
    default:
      return TYPE_META[h.type]?.label ?? h.type;
  }
}

export function sectorOf(h: Holding): string {
  if (h.type === 'psx_stock') return h.sector ?? PSX_TICKERS.find((t) => t.ticker === h.ticker)?.sector ?? 'Other';
  if (h.type === 'psx_etf') return 'ETF';
  return TYPE_META[h.type]?.label ?? 'Other';
}

export function applyFilters(holdings: Holding[], f: Filters): Holding[] {
  return holdings.filter((h) => {
    if (f.classes.length && !f.classes.includes(holdingClass(h))) return false;
    if (f.currency === 'pkr' && h.currency !== 'PKR') return false;
    if (f.currency === 'foreign' && h.currency === 'PKR') return false;
    if (f.shariah === 'yes' && shariahOf(h) !== 'yes') return false;
    if (f.liquidity === 'liquid' && !isLiquid(h)) return false;
    if (f.liquidity === 'illiquid' && isLiquid(h)) return false;
    if (f.account !== 'all' && (h.account ?? 'Self') !== f.account) return false;
    return true;
  });
}

export function filtersActive(f: Filters): boolean {
  return f.classes.length > 0 || f.currency !== 'all' || f.shariah !== 'all' || f.liquidity !== 'all' || f.account !== 'all';
}

export interface Totals {
  assets: number;
  liabilities: number;
  netWorth: number;
  cost: number;
  costCovered: number;
  pnl: number;
  pnlPct: number;
  income: number;
  incomeYield: number;
  byClass: Record<AssetClass, number>;
  hardCurrency: number;
  shariahYes: number;
  shariahUnknown: number;
  liquidWeek: number;
  count: number;
}

export function computeTotals(holdings: Holding[], liabilities: Liability[], m: MarketSnapshot): Totals {
  const byClass = Object.fromEntries(CLASS_ORDER.map((c) => [c, 0])) as Record<AssetClass, number>;
  let assets = 0, cost = 0, costCovered = 0, income = 0, hard = 0, sy = 0, su = 0, liquidWeek = 0;
  for (const h of holdings) {
    const v = valuePKR(h, m);
    assets += v;
    byClass[holdingClass(h)] += v;
    const c = costPKR(h, m);
    if (c !== undefined) {
      cost += c;
      costCovered += v;
    }
    income += annualIncomePKR(h, m);
    hard += v * hardCurrencyShare(h);
    const s = shariahOf(h);
    if (s === 'yes') sy += v;
    else if (s === 'unknown') su += v;
    const l = liquidityOf(h);
    if (l === 'instant' || l === 'days') liquidWeek += v;
  }
  const liab = liabilities.reduce((s, l) => s + liabilityPKR(l, m), 0);
  const pnl = costCovered - cost;
  return {
    assets,
    liabilities: liab,
    netWorth: assets - liab,
    cost,
    costCovered,
    pnl,
    pnlPct: cost > 0 ? (pnl / cost) * 100 : 0,
    income,
    incomeYield: assets > 0 ? (income / assets) * 100 : 0,
    byClass,
    hardCurrency: assets > 0 ? hard / assets : 0,
    shariahYes: assets > 0 ? sy / assets : 0,
    shariahUnknown: assets > 0 ? su / assets : 0,
    liquidWeek: assets > 0 ? liquidWeek / assets : 0,
    count: holdings.length,
  };
}

export function classLabel(c: AssetClass): string {
  return CLASS_META[c].label;
}

/** Days since the price was updated. */
export function priceAgeDays(h: Holding, today: string): number | undefined {
  if (h.useMarketPrice) return undefined;
  if (!h.priceDate) return undefined;
  const a = Date.parse(h.priceDate);
  const b = Date.parse(today);
  if (!isFinite(a) || !isFinite(b)) return undefined;
  return Math.round((b - a) / 864e5);
}
