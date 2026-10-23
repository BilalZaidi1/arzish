// Default capital-market assumptions and the dated market snapshot.
// Sources are listed in the product plan and shown in the Markets screen.

import type { Assumptions, MarketSnapshot, ShockKey } from './types';

export const SNAPSHOT_DATE = '2026-10-21';

export const DEFAULT_MARKET: MarketSnapshot = {
  asOf: SNAPSHOT_DATE,
  // PKR per unit of currency. USD/PKR interbank 277.00 (9 Oct 2026); AED and SAR pegged to USD;
  // EUR from EUR/USD 1.1225 (21 Oct 2026); GBP approximate.
  fx: { PKR: 1, USD: 277.0, AED: 75.43, SAR: 73.87, EUR: 310.93, GBP: 363.0 },
  fxDate: '2026-10-09',
  goldTola: 440636,
  silverTola: 6256,
  goldUsdOz: 4181,
  goldDate: '2026-10-17',
  kse100: 167089.27,
  kse100Date: '2026-10-09',
  kse100Ytd: -4.0,
  kse100Ath: 188579,
  policyRate: 11.5,
  policyDate: '2026-09-14',
  cpi: 10.26,
  cpiMonth: 'Sep 2026',
  coreCpi: 8.6,
  tbill: { m1: 11.5, m3: 12.0, m6: 12.4, m12: 12.5, date: '2026-10-14' },
  nss: {
    BSC: 12.72,
    PBA: 12.72,
    SSC: 11.82,
    DSC: 11.8,
    RIC: 11.76,
    STSC: 11.31,
    SITA3: 11.57,
    SITA5: 11.7,
    SISA: 11.33,
    SHUHADA: 12.72,
    PRIZE: 0,
  },
  nssDate: '2026-10-01',
  npcUsd: 7.25,
  btcUsd: 82264,
  btcDate: '2026-10-19',
  sp500: 7651.54,
  sp500Date: '2026-09-30',
  sp500Ytd: 12.7,
  fedFunds: 4.0,
  ust10y: 5.28,
};

/** Correlation of factor shocks, in FACTOR_ORDER: psx, gleq, glbond, gold, re, crypto, fx, rate, cpi */
export const DEFAULT_CORR: number[][] = [
  [1.0, 0.35, 0.0, 0.05, 0.2, 0.15, -0.45, -0.35, -0.25],
  [0.35, 1.0, 0.1, 0.1, 0.05, 0.45, -0.25, -0.05, -0.05],
  [0.0, 0.1, 1.0, 0.3, 0.0, 0.05, 0.05, 0.0, 0.0],
  [0.05, 0.1, 0.3, 1.0, 0.05, 0.15, 0.05, 0.0, 0.1],
  [0.2, 0.05, 0.0, 0.05, 1.0, 0.05, 0.15, -0.2, 0.35],
  [0.15, 0.45, 0.05, 0.15, 0.05, 1.0, -0.05, -0.05, 0.0],
  [-0.45, -0.25, 0.05, 0.05, 0.15, -0.05, 1.0, 0.45, 0.5],
  [-0.35, -0.05, 0.0, 0.0, -0.2, -0.05, 0.45, 1.0, 0.6],
  [-0.25, -0.05, 0.0, 0.1, 0.35, 0.0, 0.5, 0.6, 1.0],
];

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  factors: {
    psx: { cagr: 15.0, vol: 27.0 },
    gleq: { cagr: 7.0, vol: 16.0 },
    glbond: { cagr: 5.0, vol: 6.0 },
    gold: { cagr: 5.0, vol: 15.0 },
    re: { cagr: 8.0, vol: 12.0 },
    crypto: { cagr: 10.0, vol: 60.0 },
  },
  corr: DEFAULT_CORR.map((r) => r.slice()),
  macro: {
    rate0: 12.0,
    rateLR: 10.0,
    rateVol: 2.0,
    rateKappa: 0.35,
    cpi0: 10.3,
    cpiLR: 8.0,
    cpiVol: 2.5,
    cpiKappa: 0.5,
    fxDrift: 4.2,
    fxVol: 5.0,
    jumpProb: 12,
    jumpSize: 18,
    jumpPsx: -10,
    jumpRate: 2.0,
    jumpCpi: 3.0,
    usInflation: 2.8,
    usdRate: 4.0,
  },
  spreads: {
    savings: -1.5,
    tdr: -0.5,
    mmf: -0.3,
    income: 0.5,
    incomeDuration: 1.5,
    nssReinvest: 0.3,
    retirement: 0.5,
  },
  asOf: SNAPSHOT_DATE,
};

export const FACTOR_LABELS: Record<ShockKey, string> = {
  psx: 'PSX equities',
  gleq: 'Global equities',
  glbond: 'USD bonds',
  gold: 'Gold (USD)',
  re: 'Pakistan property',
  crypto: 'Crypto',
  fx: 'USD/PKR',
  rate: 'PKR short rate',
  cpi: 'Pakistan CPI',
};

export const FACTOR_SHORT: Record<ShockKey, string> = {
  psx: 'PSX',
  gleq: 'Global eq.',
  glbond: 'USD bonds',
  gold: 'Gold',
  re: 'Property',
  crypto: 'Crypto',
  fx: 'USD/PKR',
  rate: 'Rate',
  cpi: 'CPI',
};

/** Expected total yearly USD/PKR change implied by the macro assumptions (approx, %). */
export function expectedFxChange(a: Assumptions): number {
  const m = a.macro;
  const logDrift = Math.log(1 + m.fxDrift / 100);
  const jump = (m.jumpProb / 100) * Math.log(1 + m.jumpSize / 100);
  return (Math.exp(logDrift + jump) - 1) * 100;
}

export interface SourceRef {
  label: string;
  url: string;
  asOf: string;
}

export const SOURCES: Record<string, SourceRef> = {
  kse: { label: 'Mettis Global', url: 'https://mettisglobal.news/PSX-Closing-Bell-A-Shade-Lowe-64101', asOf: '9 Oct 2026' },
  kseHistory: { label: 'Wikipedia: KSE 100 Index', url: 'https://en.wikipedia.org/wiki/KSE_100_Index', asOf: '2025' },
  policy: { label: 'ARY News', url: 'https://arynews.tv/monetary-policy-sbp-retains-interest-rate-11-5-percent', asOf: '14 Sep 2026' },
  cpi: { label: 'ProPakistani', url: 'https://propakistani.pk/2026/10/01/inflation-remains-high-after-3-months/', asOf: 'Sep 2026' },
  tbill: { label: 'Pakera', url: 'https://pakera.pk/sbp-tbill-auction-result-14-october-2026-cut-off-yields/', asOf: '14 Oct 2026' },
  nss: { label: 'Mettis Global', url: 'https://mettisglobal.news/CDNS-raises-profit-rates-across-key-savings-instruments-63895', asOf: '1 Oct 2026' },
  fx: { label: 'Mettis Global', url: 'https://mettisglobal.news/PKR-edges-up-to-Rs277-against-USD-64100', asOf: '9 Oct 2026' },
  gold: { label: 'Daily Pakistan', url: 'https://en.dailypakistan.com.pk/?p=345492', asOf: '17 Oct 2026' },
  btc: { label: 'Bitcoin News Digest', url: 'https://bitcoinnewsdigest.substack.com/p/bitcoin-news-digest-october-19-2026', asOf: '19 Oct 2026' },
  global: { label: 'First Trust', url: 'https://www.ftportfolios.com/Commentary/MarketCommentary/2026/10/8/a-recap-of-september-2026', asOf: '30 Sep 2026' },
  eurusd: { label: 'Pound Sterling Live', url: 'https://www.poundsterlinglive.com/history/EUR-USD-2026', asOf: '21 Oct 2026' },
  rent: { label: 'Global Property Guide', url: 'https://www.globalpropertyguide.com/asia/pakistan/rental-yields', asOf: 'Q1 2026' },
  tax: { label: 'KPMG Pakistan, TY2027 rate card', url: 'https://kpmg.com/pk/en/insights/2026/07/withholding-tax-collection-deduction--ty-2027.html', asOf: 'Jul 2026' },
  cgt: { label: 'ICT: CGT on PSX shares 2026', url: 'https://www.ict.edu.pk/blogs/tax-on-psx-share-trading-pakistan-2026-cgt-rules', asOf: '2026' },
  property: { label: 'Baco Consultants: 236C/236K', url: 'https://bacoconsultants.com/blogs/property-tax-pakistan-2026-27-236c-236k-rates', asOf: '2026' },
  npc: { label: 'JS Bank: Naya Pakistan Certificates', url: 'https://jsbl.com/js-roshan-digital-account/naya-pakistan-certificate/', asOf: '19 Oct 2026' },
};
