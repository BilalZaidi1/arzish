// Historical reference data (calendar year ends) and a class-level backtest of today's mix.
// KSE-100 closes are from Wikipedia (sourced). Other series are approximate year-end values
// compiled for context (SBP, PBS, S&P, LBMA, exchange data) and are labelled approximate in the UI.

import type { OptClass } from './types';

export const KSE100: Record<number, number> = {
  2004: 6218.46, 2005: 9556.61, 2006: 10040.5, 2007: 14075.83, 2008: 5865.01, 2009: 9386.92, 2010: 12022.46,
  2011: 11347.66, 2012: 16905.33, 2013: 25261.14, 2014: 32131.28, 2015: 32816.31, 2016: 47806.97, 2017: 40471.48,
  2018: 37066.67, 2019: 40735.08, 2020: 43755.38, 2021: 44596.07, 2022: 40420.45, 2023: 62451.04, 2024: 115127,
  2025: 174054,
};

export const USDPKR: Record<number, number> = {
  2005: 59.83, 2006: 60.92, 2007: 61.62, 2008: 79.1, 2009: 84.25, 2010: 85.71, 2011: 89.95, 2012: 97.14, 2013: 105.33,
  2014: 100.5, 2015: 104.8, 2016: 104.8, 2017: 110.5, 2018: 138.9, 2019: 154.9, 2020: 159.8, 2021: 176.5, 2022: 226.4,
  2023: 281.9, 2024: 278.6, 2025: 280.12,
};

/** S&P 500 total return, % (approximate). */
export const SP500_TR: Record<number, number> = {
  2006: 15.79, 2007: 5.49, 2008: -37.0, 2009: 26.46, 2010: 15.06, 2011: 2.11, 2012: 16.0, 2013: 32.39, 2014: 13.69,
  2015: 1.38, 2016: 11.96, 2017: 21.83, 2018: -4.38, 2019: 31.49, 2020: 18.4, 2021: 28.71, 2022: -18.11, 2023: 26.29,
  2024: 25.02, 2025: 17.88,
};

/** Gold, USD per ounce, year end (approximate; 2025 derived from 2026 data). */
export const GOLD_USD: Record<number, number> = {
  2005: 513, 2006: 632, 2007: 834, 2008: 870, 2009: 1087, 2010: 1405, 2011: 1531, 2012: 1657, 2013: 1204, 2014: 1206,
  2015: 1060, 2016: 1146, 2017: 1291, 2018: 1279, 2019: 1515, 2020: 1888, 2021: 1806, 2022: 1812, 2023: 2063, 2024: 2610,
  2025: 4310,
};

/** Bitcoin, USD, year end (approximate). */
export const BTC_USD: Record<number, number> = {
  2014: 320, 2015: 430, 2016: 964, 2017: 13860, 2018: 3740, 2019: 7190, 2020: 28990, 2021: 46310, 2022: 16550,
  2023: 42270, 2024: 93430, 2025: 87500,
};

/** Pakistan CPI inflation, fiscal-year average %, mapped to the calendar year the fiscal year ends (approximate). */
export const PK_CPI: Record<number, number> = {
  2006: 7.9, 2007: 7.8, 2008: 12.0, 2009: 20.8, 2010: 11.7, 2011: 13.7, 2012: 11.0, 2013: 7.4, 2014: 8.6, 2015: 4.5,
  2016: 2.9, 2017: 4.2, 2018: 3.9, 2019: 7.3, 2020: 10.7, 2021: 8.9, 2022: 12.2, 2023: 29.2, 2024: 23.4, 2025: 4.5,
};

/** PKR T-bill / money-market return, % (approximate yearly average). */
export const PK_TBILL: Record<number, number> = {
  2006: 8.8, 2007: 9.0, 2008: 11.5, 2009: 12.5, 2010: 12.4, 2011: 13.0, 2012: 11.0, 2013: 9.2, 2014: 9.7, 2015: 7.2,
  2016: 5.9, 2017: 5.9, 2018: 7.5, 2019: 12.5, 2020: 8.5, 2021: 7.8, 2022: 14.5, 2023: 21.5, 2024: 18.0, 2025: 11.0,
};

/** US 3-month T-bill, % (approximate yearly average). */
export const US_CASH: Record<number, number> = {
  2006: 4.7, 2007: 4.4, 2008: 1.4, 2009: 0.15, 2010: 0.14, 2011: 0.05, 2012: 0.09, 2013: 0.06, 2014: 0.03, 2015: 0.05,
  2016: 0.32, 2017: 0.93, 2018: 1.94, 2019: 2.06, 2020: 0.35, 2021: 0.05, 2022: 2.02, 2023: 5.07, 2024: 5.0, 2025: 4.2,
};

export const HISTORY_FIRST = 2006;
export const HISTORY_LAST = 2025;

export function fxChange(y: number): number {
  return USDPKR[y] / USDPKR[y - 1] - 1;
}

/** Yearly PKR return of each class proxy in calendar year y. */
export function classReturn(c: OptClass | 'realestate' | 'other', y: number): number {
  switch (c) {
    case 'psx':
      return KSE100[y] / KSE100[y - 1] - 1;
    case 'gleq':
      return (1 + SP500_TR[y] / 100) * (1 + fxChange(y)) - 1;
    case 'gold':
      return (GOLD_USD[y] / GOLD_USD[y - 1]) * (1 + fxChange(y)) - 1;
    case 'pkfi':
      return PK_TBILL[y] / 100;
    case 'usd':
      return (1 + US_CASH[y] / 100) * (1 + fxChange(y)) - 1;
    case 'crypto':
      return BTC_USD[y - 1] ? (BTC_USD[y] / BTC_USD[y - 1]) * (1 + fxChange(y)) - 1 : PK_TBILL[y] / 100;
    case 'realestate':
      return PK_CPI[y] / 100 + 0.01;
    case 'other':
    default:
      return PK_CPI[y] / 100;
  }
}

export interface BacktestResult {
  years: number[];
  portfolio: number[];
  kse: number[];
  kseUsd: number[];
  cash: number[];
  cpi: number[];
  yearly: number[];
  cagr: number;
  realCagr: number;
  best: { year: number; ret: number };
  worst: { year: number; ret: number };
  maxDD: number;
  kseCagr: number;
}

export type BacktestWeights = Partial<Record<OptClass | 'realestate' | 'other', number>>;

export function backtest(weights: BacktestWeights, start: number): BacktestResult {
  const keys = Object.keys(weights) as (keyof BacktestWeights)[];
  const tot = keys.reduce((s, k) => s + (weights[k] ?? 0), 0) || 1;
  const years: number[] = [start];
  const portfolio = [100], kse = [100], kseUsd = [100], cash = [100], cpi = [100];
  const yearly: number[] = [];
  let peak = 100, maxDD = 0;
  for (let y = start + 1; y <= HISTORY_LAST; y++) {
    let r = 0;
    for (const k of keys) r += ((weights[k] ?? 0) / tot) * classReturn(k, y);
    yearly.push(r);
    years.push(y);
    portfolio.push(portfolio[portfolio.length - 1] * (1 + r));
    const kr = KSE100[y] / KSE100[y - 1] - 1;
    kse.push(kse[kse.length - 1] * (1 + kr));
    kseUsd.push(kseUsd[kseUsd.length - 1] * ((1 + kr) / (1 + fxChange(y))));
    cash.push(cash[cash.length - 1] * (1 + PK_TBILL[y] / 100));
    cpi.push(cpi[cpi.length - 1] * (1 + PK_CPI[y] / 100));
    const v = portfolio[portfolio.length - 1];
    if (v > peak) peak = v;
    maxDD = Math.max(maxDD, 1 - v / peak);
  }
  const n = years.length - 1;
  const cagr = Math.pow(portfolio[n] / 100, 1 / n) - 1;
  const realCagr = Math.pow(portfolio[n] / cpi[n], 1 / n) - 1;
  const kseCagr = Math.pow(kse[n] / 100, 1 / n) - 1;
  let best = { year: years[1], ret: -Infinity }, worst = { year: years[1], ret: Infinity };
  yearly.forEach((r, i) => {
    if (r > best.ret) best = { year: years[i + 1], ret: r };
    if (r < worst.ret) worst = { year: years[i + 1], ret: r };
  });
  return { years, portfolio, kse, kseUsd, cash, cpi, yearly, cagr, realCagr, best, worst, maxDD, kseCagr };
}
