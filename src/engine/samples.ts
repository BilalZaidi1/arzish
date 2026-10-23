// Example portfolios (illustrative prices, clearly marked in the UI) and workspace defaults.

import { DEFAULT_ASSUMPTIONS, DEFAULT_MARKET } from './assumptions';
import { addMonthsISO, todayISO, uid } from './format';
import type { Goal, Holding, Liability, PlanSettings, Portfolio, Settings, Workspace } from './types';

export const SCHEMA_VERSION = 1;

export function defaultPlan(over: Partial<PlanSettings> = {}): PlanSettings {
  return {
    horizonYears: 20,
    sipMonthly: 0,
    sipStepUp: 5,
    lumpSums: [],
    withdrawals: [],
    contributionMix: 'current',
    rebalance: 'none',
    reinvestIncome: true,
    applyTax: true,
    applyZakat: false,
    paths: 2000,
    seed: 2026,
    retirement: { enabled: false, age: 35, retireAge: 60, lifeAge: 85, monthlyNeed: 200_000, pension: 0 },
    ...over,
  };
}

export function defaultSettings(): Settings {
  return {
    baseCurrency: 'PKR',
    numberStyle: 'lakh',
    realTerms: false,
    theme: 'system',
    filer: true,
    nisabBasis: 'silver',
    monthlyExpenses: 250_000,
    aiDepth: 'standard',
    foreignCgtRate: 15,
  };
}

const H = (h: Omit<Holding, 'id'>): Holding => ({ id: uid('h'), ...h });
const G = (g: Omit<Goal, 'id'>): Goal => ({ id: uid('g'), ...g });
const LB = (l: Omit<Liability, 'id'>): Liability => ({ id: uid('l'), ...l });

function yearsFromNow(y: number, month = 6): string {
  const t = todayISO();
  return addMonthsISO(`${Number(t.slice(0, 4)) + y}-${String(month).padStart(2, '0')}-01`, 0);
}

function base(name: string, key: string, holdings: Holding[], extra: Partial<Portfolio> = {}): Portfolio {
  const now = new Date().toISOString();
  return {
    id: uid('p'),
    name,
    isExample: true,
    exampleKey: key,
    holdings,
    liabilities: [],
    goals: [],
    plan: defaultPlan(),
    scenarios: [],
    pinned: [],
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

export function exampleBalanced(): Portfolio {
  return base('Example: Karachi professional', 'balanced', [
    H({ type: 'psx_stock', name: 'Meezan Bank', ticker: 'MEBL', currency: 'PKR', qty: 1500, price: 420, avgCost: 245, purchaseDate: '2024-03-12', sector: 'Commercial banks', account: 'Self' }),
    H({ type: 'psx_stock', name: 'Oil & Gas Development Co.', ticker: 'OGDC', currency: 'PKR', qty: 3500, price: 265, avgCost: 182, purchaseDate: '2024-09-04', sector: 'Oil & gas exploration', account: 'Self' }),
    H({ type: 'psx_stock', name: 'Systems Ltd', ticker: 'SYS', currency: 'PKR', qty: 2500, price: 160, avgCost: 120, purchaseDate: '2025-02-18', sector: 'Technology', account: 'Self' }),
    H({ type: 'psx_stock', name: 'Hub Power Co.', ticker: 'HUBC', currency: 'PKR', qty: 3000, price: 150, avgCost: 118, purchaseDate: '2024-11-20', sector: 'Power generation', account: 'Self' }),
    H({ type: 'psx_stock', name: 'Fauji Fertilizer Co.', ticker: 'FFC', currency: 'PKR', qty: 1200, price: 410, avgCost: 330, purchaseDate: '2025-05-07', sector: 'Fertilizer', account: 'Self' }),
    H({ type: 'mutual_fund', name: 'Islamic equity fund', sub: 'islamic_equity', currency: 'PKR', qty: 14000, price: 112, avgCost: 81, purchaseDate: '2024-08-15', account: 'Self' }),
    H({ type: 'mutual_fund', name: 'Money market fund', sub: 'money_market', currency: 'PKR', qty: 230000, price: 10.85, avgCost: 10.2, purchaseDate: '2025-10-01', account: 'Self' }),
    H({ type: 'vps', name: 'VPS pension plan', sub: 'vps_medium', currency: 'PKR', qty: 4200, price: 290, avgCost: 220, purchaseDate: '2023-07-01', account: 'Self' }),
    H({ type: 'nss', name: 'Regular Income Certificates', sub: 'RIC', currency: 'PKR', qty: 1, price: 3_000_000, avgCost: 3_000_000, rate: 11.76, purchaseDate: '2025-12-01', account: 'Joint' }),
    H({ type: 'deposit', name: 'Bank savings account', sub: 'savings', currency: 'PKR', qty: 1, price: 850_000, rate: 9.5, account: 'Joint' }),
    H({ type: 'gold', name: 'Gold jewellery and coins', currency: 'PKR', qty: 10, unit: 'tola', karat: 22, price: 440_636, useMarketPrice: true, avgCost: 210_000, purchaseDate: '2022-11-01', account: 'Spouse' }),
    H({ type: 'property', name: 'Apartment, Clifton', sub: 'apartment', city: 'Karachi', currency: 'PKR', qty: 1, price: 16_000_000, avgCost: 11_500_000, purchaseDate: '2021-04-10', area: 1450, areaUnit: 'sqft', rentMonthly: 85_000, costsAnnual: 110_000, vacancyPct: 5, propertyUse: 'rented', account: 'Joint' }),
    H({ type: 'global_etf', name: 'Vanguard S&P 500 ETF', ticker: 'VOO', currency: 'USD', qty: 30, price: 700, avgCost: 520, purchaseDate: '2024-06-03', account: 'Self' }),
    H({ type: 'crypto', name: 'Bitcoin', ticker: 'BTC', sub: 'btc', currency: 'USD', qty: 0.05, price: 82_264, useMarketPrice: true, avgCost: 61_000, purchaseDate: '2024-10-15', account: 'Self' }),
  ], {
    liabilities: [LB({ type: 'car', name: 'Car financing', currency: 'PKR', balance: 1_800_000, rate: 14, payment: 52_000, endDate: yearsFromNow(3, 9) })],
    goals: [
      G({ name: 'Hajj for two', kind: 'hajj', target: 2_800_000, date: yearsFromNow(2, 5), inflation: 9, priority: 'medium', withdraw: true }),
      G({ name: 'Upgrade to a bigger home', kind: 'home', target: 30_000_000, date: yearsFromNow(5, 6), inflation: 9, priority: 'medium', withdraw: true }),
      G({ name: "Daughter's university", kind: 'education', target: 8_000_000, date: yearsFromNow(12, 8), inflation: 11, priority: 'high', withdraw: true }),
      G({ name: 'Retirement corpus', kind: 'retirement', target: 60_000_000, date: yearsFromNow(22, 1), inflation: 8, priority: 'high', withdraw: false }),
    ],
    plan: defaultPlan({ sipMonthly: 75_000, sipStepUp: 8, horizonYears: 20, retirement: { enabled: false, age: 36, retireAge: 60, lifeAge: 85, monthlyNeed: 250_000, pension: 0 } }),
  });
}

export function exampleRetiree(): Portfolio {
  return base('Example: Lahore retiree', 'retiree', [
    H({ type: 'nss', name: 'Behbood Savings Certificates', sub: 'BSC', currency: 'PKR', qty: 1, price: 5_000_000, avgCost: 5_000_000, rate: 12.72, purchaseDate: '2024-02-01', account: 'Self' }),
    H({ type: 'nss', name: "Pensioners' Benefit Account", sub: 'PBA', currency: 'PKR', qty: 1, price: 3_000_000, avgCost: 3_000_000, rate: 12.72, purchaseDate: '2023-06-01', account: 'Self' }),
    H({ type: 'nss', name: 'Regular Income Certificates', sub: 'RIC', currency: 'PKR', qty: 1, price: 2_000_000, avgCost: 2_000_000, rate: 11.76, purchaseDate: '2025-03-01', account: 'Spouse' }),
    H({ type: 'govt_sec', name: '12-month T-bill', sub: 'tbill', currency: 'PKR', qty: 1, price: 1_500_000, avgCost: 1_500_000, rate: 12.5, maturity: yearsFromNow(1, 10), account: 'Self' }),
    H({ type: 'mutual_fund', name: 'Islamic income fund', sub: 'islamic_income', currency: 'PKR', qty: 90000, price: 112, avgCost: 104, purchaseDate: '2025-07-01', account: 'Self' }),
    H({ type: 'deposit', name: 'Savings account', sub: 'savings', currency: 'PKR', qty: 1, price: 600_000, rate: 9.5, account: 'Joint' }),
    H({ type: 'gold', name: 'Gold bars', currency: 'PKR', qty: 15, unit: 'tola', karat: 24, price: 440_636, useMarketPrice: true, avgCost: 150_000, purchaseDate: '2020-01-15', account: 'Joint' }),
    H({ type: 'property', name: 'Family house, Model Town', sub: 'house', city: 'Lahore', currency: 'PKR', qty: 1, price: 45_000_000, avgCost: 9_000_000, purchaseDate: '2004-05-01', area: 1, areaUnit: 'kanal', propertyUse: 'self', account: 'Joint' }),
  ], {
    goals: [G({ name: 'Umrah', kind: 'hajj', target: 1_200_000, date: yearsFromNow(1, 3), inflation: 9, priority: 'medium', withdraw: true })],
    // Living off the portfolio: income stays invested and the drawdown pays the bills.
    plan: defaultPlan({ sipMonthly: 0, horizonYears: 15, reinvestIncome: true, withdrawals: [], retirement: { enabled: true, age: 64, retireAge: 64, lifeAge: 88, monthlyNeed: 170_000, pension: 60_000 } }),
  });
}

export function exampleOverseas(): Portfolio {
  return base('Example: Overseas Pakistani in Dubai', 'overseas', [
    H({ type: 'fx_cash', name: 'AED savings account', sub: 'fcy_deposit', currency: 'AED', qty: 1, price: 150_000, rate: 2.0, account: 'Self' }),
    H({ type: 'fx_cash', name: 'Naya Pakistan Certificate, 3-year', sub: 'npc', currency: 'USD', qty: 1, price: 40_000, rate: 7.5, maturity: yearsFromNow(2, 2), account: 'Self' }),
    H({ type: 'global_etf', name: 'Vanguard FTSE All-World UCITS ETF', ticker: 'VWRA', currency: 'USD', qty: 450, price: 160, avgCost: 128, purchaseDate: '2024-04-10', account: 'Self' }),
    H({ type: 'global_etf', name: 'Invesco QQQ Trust', ticker: 'QQQ', currency: 'USD', qty: 35, price: 735, avgCost: 470, purchaseDate: '2023-11-20', account: 'Self' }),
    H({ type: 'global_stock', name: 'NVIDIA', ticker: 'NVDA', currency: 'USD', qty: 60, price: 190, avgCost: 120, purchaseDate: '2025-01-15', account: 'Self' }),
    H({ type: 'psx_etf', name: 'Meezan Pakistan ETF', ticker: 'MZNPETF', currency: 'PKR', qty: 60000, price: 32, avgCost: 18, purchaseDate: '2024-05-10', account: 'Self' }),
    H({ type: 'property', name: 'Residential plot, DHA Phase 9', sub: 'residential_plot', city: 'Lahore', currency: 'PKR', qty: 1, price: 18_000_000, avgCost: 12_500_000, purchaseDate: '2022-08-01', area: 1, areaUnit: 'kanal', propertyUse: 'investment', costsAnnual: 30_000, account: 'Self' }),
    H({ type: 'gold', name: 'Gold coins', currency: 'PKR', qty: 5, unit: 'tola', karat: 24, price: 440_636, useMarketPrice: true, avgCost: 280_000, purchaseDate: '2024-12-01', account: 'Self' }),
    H({ type: 'crypto', name: 'Ether', ticker: 'ETH', sub: 'eth', currency: 'USD', qty: 3, price: 3_100, avgCost: 2_400, purchaseDate: '2025-03-01', account: 'Self' }),
  ], {
    goals: [
      G({ name: 'Home in Lahore', kind: 'home', target: 40_000_000, date: yearsFromNow(6, 6), inflation: 9, priority: 'high', withdraw: true }),
      G({ name: "Children's education", kind: 'education', target: 9_000_000, date: yearsFromNow(10, 8), inflation: 11, priority: 'high', withdraw: true }),
    ],
    plan: defaultPlan({ sipMonthly: 250_000, sipStepUp: 5, horizonYears: 15, contributionMix: 'current' }),
  });
}

export function exampleShariah(): Portfolio {
  return base('Example: Shariah-compliant family', 'shariah', [
    H({ type: 'psx_stock', name: 'Meezan Bank', ticker: 'MEBL', currency: 'PKR', qty: 2000, price: 420, avgCost: 260, purchaseDate: '2024-06-01', sector: 'Commercial banks', account: 'Self' }),
    H({ type: 'psx_etf', name: 'Meezan Pakistan ETF', ticker: 'MZNPETF', currency: 'PKR', qty: 80000, price: 32, avgCost: 21, purchaseDate: '2024-09-01', account: 'Self' }),
    H({ type: 'mutual_fund', name: 'Islamic equity fund', sub: 'islamic_equity', currency: 'PKR', qty: 20000, price: 112, avgCost: 84, purchaseDate: '2024-07-01', account: 'Spouse' }),
    H({ type: 'mutual_fund', name: 'Islamic money market fund', sub: 'islamic_mm', currency: 'PKR', qty: 300000, price: 10.6, avgCost: 10.1, purchaseDate: '2025-08-01', account: 'Joint' }),
    H({ type: 'mutual_fund', name: 'Islamic income fund', sub: 'islamic_income', currency: 'PKR', qty: 25000, price: 112, avgCost: 103, purchaseDate: '2025-04-01', account: 'Joint' }),
    H({ type: 'nss', name: 'Sarwa Islamic Term Account, 5 years', sub: 'SITA5', currency: 'PKR', qty: 1, price: 2_500_000, avgCost: 2_500_000, rate: 11.7, purchaseDate: '2026-01-15', account: 'Joint' }),
    H({ type: 'govt_sec', name: 'GOP Ijara sukuk', sub: 'gis', currency: 'PKR', qty: 1, price: 1_000_000, avgCost: 1_000_000, rate: 11.8, account: 'Self' }),
    H({ type: 'deposit', name: 'Islamic savings account', sub: 'islamic_savings', currency: 'PKR', qty: 1, price: 700_000, rate: 9.0, account: 'Joint' }),
    H({ type: 'gold', name: 'Gold jewellery', currency: 'PKR', qty: 12, unit: 'tola', karat: 22, price: 440_636, useMarketPrice: true, avgCost: 190_000, purchaseDate: '2021-12-01', account: 'Spouse' }),
    H({ type: 'property', name: 'House, Bahria Town', sub: 'house', city: 'Islamabad', currency: 'PKR', qty: 1, price: 32_000_000, avgCost: 21_000_000, purchaseDate: '2020-09-01', area: 10, areaUnit: 'marla', propertyUse: 'self', account: 'Joint' }),
  ], {
    goals: [
      G({ name: 'Hajj', kind: 'hajj', target: 2_600_000, date: yearsFromNow(3, 5), inflation: 9, priority: 'high', withdraw: true }),
      G({ name: "Son's wedding", kind: 'wedding', target: 4_500_000, date: yearsFromNow(7, 12), inflation: 10, priority: 'medium', withdraw: true }),
    ],
    plan: defaultPlan({ sipMonthly: 60_000, sipStepUp: 7, horizonYears: 15, applyZakat: true }),
  });
}

export function examplePsx(): Portfolio {
  return base('Example: PSX active investor', 'psx', [
    H({ type: 'psx_stock', name: 'Oil & Gas Development Co.', ticker: 'OGDC', currency: 'PKR', qty: 6000, price: 265, avgCost: 140, purchaseDate: '2024-02-01', sector: 'Oil & gas exploration' }),
    H({ type: 'psx_stock', name: 'Pakistan Petroleum', ticker: 'PPL', currency: 'PKR', qty: 5000, price: 190, avgCost: 120, purchaseDate: '2024-03-15', sector: 'Oil & gas exploration' }),
    H({ type: 'psx_stock', name: 'Meezan Bank', ticker: 'MEBL', currency: 'PKR', qty: 3000, price: 420, avgCost: 230, purchaseDate: '2024-01-10', sector: 'Commercial banks' }),
    H({ type: 'psx_stock', name: 'MCB Bank', ticker: 'MCB', currency: 'PKR', qty: 2000, price: 330, avgCost: 210, purchaseDate: '2024-04-20', sector: 'Commercial banks' }),
    H({ type: 'psx_stock', name: 'Lucky Cement', ticker: 'LUCK', currency: 'PKR', qty: 1500, price: 470, avgCost: 360, purchaseDate: '2025-06-01', sector: 'Cement' }),
    H({ type: 'psx_stock', name: 'Maple Leaf Cement', ticker: 'MLCF', currency: 'PKR', qty: 10000, price: 95, avgCost: 52, purchaseDate: '2024-07-01', sector: 'Cement' }),
    H({ type: 'psx_stock', name: 'Fauji Fertilizer Co.', ticker: 'FFC', currency: 'PKR', qty: 2500, price: 410, avgCost: 290, purchaseDate: '2025-01-20', sector: 'Fertilizer' }),
    H({ type: 'psx_stock', name: 'Engro Fertilizers', ticker: 'EFERT', currency: 'PKR', qty: 4000, price: 215, avgCost: 190, purchaseDate: '2025-08-01', sector: 'Fertilizer' }),
    H({ type: 'psx_stock', name: 'Hub Power Co.', ticker: 'HUBC', currency: 'PKR', qty: 5000, price: 150, avgCost: 105, purchaseDate: '2024-05-01', sector: 'Power generation' }),
    H({ type: 'psx_stock', name: 'Systems Ltd', ticker: 'SYS', currency: 'PKR', qty: 4000, price: 160, avgCost: 150, purchaseDate: '2025-09-01', sector: 'Technology' }),
    H({ type: 'psx_stock', name: 'Pakistan State Oil', ticker: 'PSO', currency: 'PKR', qty: 2500, price: 430, avgCost: 240, purchaseDate: '2024-10-01', sector: 'Oil & gas marketing' }),
    H({ type: 'psx_stock', name: 'Indus Motor Co.', ticker: 'INDU', currency: 'PKR', qty: 300, price: 2100, avgCost: 1700, purchaseDate: '2025-03-01', sector: 'Automobiles' }),
    H({ type: 'mutual_fund', name: 'Money market fund (dry powder)', sub: 'money_market', currency: 'PKR', qty: 180000, price: 10.85, avgCost: 10.4, purchaseDate: '2026-04-01' }),
    H({ type: 'crypto', name: 'Bitcoin', ticker: 'BTC', sub: 'btc', currency: 'USD', qty: 0.08, price: 82_264, useMarketPrice: true, avgCost: 68_000, purchaseDate: '2025-02-01' }),
  ], {
    plan: defaultPlan({ sipMonthly: 100_000, sipStepUp: 10, horizonYears: 10 }),
    goals: [G({ name: 'Financial independence fund', kind: 'retirement', target: 80_000_000, date: yearsFromNow(12, 6), inflation: 8, priority: 'high', withdraw: false })],
  });
}

export const EXAMPLE_BUILDERS: { key: string; label: string; blurb: string; build: () => Portfolio }[] = [
  { key: 'balanced', label: 'Karachi professional', blurb: 'PSX, funds, NSS, gold, a rented flat, US ETF and a little bitcoin', build: exampleBalanced },
  { key: 'retiree', label: 'Lahore retiree', blurb: 'Behbood, Pensioners, RIC, T-bills and gold for monthly income', build: exampleRetiree },
  { key: 'overseas', label: 'Overseas Pakistani in Dubai', blurb: 'AED and USD savings, global ETFs, a plot back home', build: exampleOverseas },
  { key: 'shariah', label: 'Shariah-compliant family', blurb: 'Islamic funds, MEBL, sukuk, Sarwa Islamic and gold', build: exampleShariah },
  { key: 'psx', label: 'PSX active investor', blurb: '12 stocks across sectors, a money market buffer and bitcoin', build: examplePsx },
];

export function emptyPortfolio(name = 'My portfolio'): Portfolio {
  const now = new Date().toISOString();
  return {
    id: uid('p'),
    name,
    holdings: [],
    liabilities: [],
    goals: [],
    plan: defaultPlan({ sipMonthly: 50_000 }),
    scenarios: [],
    pinned: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createWorkspace(): Workspace {
  const first = exampleBalanced();
  return {
    version: SCHEMA_VERSION,
    settings: defaultSettings(),
    portfolios: [first, exampleRetiree(), exampleOverseas(), exampleShariah(), examplePsx()],
    activeId: first.id,
    market: JSON.parse(JSON.stringify(DEFAULT_MARKET)),
    assumptions: JSON.parse(JSON.stringify(DEFAULT_ASSUMPTIONS)),
    updatedAt: new Date().toISOString(),
  };
}

/** Bring an older or partial workspace up to the current shape. */
export function migrateWorkspace(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Partial<Workspace>;
  if (!Array.isArray(w.portfolios) || !w.portfolios.length) return null;
  const settings = { ...defaultSettings(), ...(w.settings ?? {}) };
  const market = { ...DEFAULT_MARKET, ...(w.market ?? {}), fx: { ...DEFAULT_MARKET.fx, ...(w.market?.fx ?? {}) }, nss: { ...DEFAULT_MARKET.nss, ...(w.market?.nss ?? {}) }, tbill: { ...DEFAULT_MARKET.tbill, ...(w.market?.tbill ?? {}) } };
  const assumptions = w.assumptions && Array.isArray(w.assumptions.corr) && w.assumptions.corr.length === 9
    ? { ...DEFAULT_ASSUMPTIONS, ...w.assumptions, macro: { ...DEFAULT_ASSUMPTIONS.macro, ...w.assumptions.macro }, spreads: { ...DEFAULT_ASSUMPTIONS.spreads, ...w.assumptions.spreads }, factors: { ...DEFAULT_ASSUMPTIONS.factors, ...w.assumptions.factors } }
    : JSON.parse(JSON.stringify(DEFAULT_ASSUMPTIONS));
  const portfolios = w.portfolios.map((p) => ({
    ...emptyPortfolio(p.name || 'Portfolio'),
    ...p,
    plan: { ...defaultPlan(), ...(p.plan ?? {}), retirement: { ...defaultPlan().retirement, ...(p.plan?.retirement ?? {}) } },
    holdings: Array.isArray(p.holdings) ? p.holdings.filter((h) => h && h.type && h.id) : [],
    liabilities: Array.isArray(p.liabilities) ? p.liabilities : [],
    goals: Array.isArray(p.goals) ? p.goals : [],
    scenarios: Array.isArray(p.scenarios) ? p.scenarios : [],
    pinned: Array.isArray(p.pinned) ? p.pinned : [],
  }));
  const activeId = portfolios.some((p) => p.id === w.activeId) ? w.activeId! : portfolios[0].id;
  return { version: SCHEMA_VERSION, settings, portfolios, activeId, market, assumptions, updatedAt: w.updatedAt ?? new Date().toISOString() };
}
