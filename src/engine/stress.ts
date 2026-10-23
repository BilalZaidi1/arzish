// Instant stress tests: factor shocks mapped through each holding's exposures.

import { GOVT_KINDS, fundCategory } from './catalog';
import type { AssetClass, Holding, Liability, MarketSnapshot, Shocks } from './types';
import { CLASS_ORDER } from './types';
import { cryptoKind, globalTicker, holdingClass, liabilityPKR, sectorDefaults, valuePKR } from './valuation';
import { PSX_TICKERS } from './catalog';

export interface StressScenario {
  key: string;
  name: string;
  kind: 'historical' | 'hypothetical' | 'upside';
  period?: string;
  description: string;
  shocks: Shocks;
}

/** Shocks: asset factors and USD/PKR in % change; rate and CPI in percentage points. */
export const STRESS_PRESETS: StressScenario[] = [
  {
    key: 'gfc2008', name: '2008 global financial crisis', kind: 'historical', period: '2008',
    description: 'KSE-100 fell 58% in 2008 while the rupee lost about a fifth of its value and SBP raised rates.',
    shocks: { psx: -58, gleq: -37, glbond: 5, gold: 5, re: -10, crypto: -50, fx: 28, rate: 5, cpi: 12 },
  },
  {
    key: 'bop2022', name: '2022–23 balance-of-payments crisis', kind: 'historical', period: '2022–2023',
    description: 'USD/PKR jumped from about 176 to 287, the policy rate rose to 22% and CPI peaked near 38%.',
    shocks: { psx: -20, gleq: -18, glbond: -13, gold: 0, re: 5, crypto: -65, fx: 60, rate: 12, cpi: 25 },
  },
  {
    key: 'psx2017', name: '2017–18 PSX correction', kind: 'historical', period: 'May 2017 – Dec 2018',
    description: 'KSE-100 slid about 30% from its 2017 peak as the rupee fell from 105 to 139 and rates rose.',
    shocks: { psx: -30, gleq: -5, gold: 0, re: 0, crypto: -70, fx: 32, rate: 4.25, cpi: 3 },
  },
  {
    key: 'covid2020', name: 'COVID-19 crash', kind: 'historical', period: 'Feb – Mar 2020',
    description: 'Markets crashed in weeks; SBP cut rates by 6.25 points and the rupee weakened about 8%.',
    shocks: { psx: -37, gleq: -34, glbond: 3, gold: -3, re: -5, crypto: -50, fx: 8, rate: -6.25, cpi: -4 },
  },
  {
    key: 'deval', name: 'Sharp rupee devaluation', kind: 'hypothetical',
    description: 'USD/PKR rises 30% within months; SBP hikes and inflation jumps.',
    shocks: { psx: -15, fx: 30, rate: 5, cpi: 8, re: 5 },
  },
  {
    key: 'hike', name: 'SBP raises rates by 500 bps', kind: 'hypothetical',
    description: 'A sudden tightening: equities and property reprice, bond prices fall.',
    shocks: { psx: -15, re: -5, rate: 5, cpi: 2 },
  },
  {
    key: 'oil', name: 'Middle East oil shock', kind: 'hypothetical',
    description: 'Oil spikes on a wider regional war: import bill widens, rupee and PSX weaken, gold rallies.',
    shocks: { psx: -15, gleq: -10, glbond: -3, gold: 12, crypto: -15, fx: 10, rate: 3, cpi: 5 },
  },
  {
    key: 'property', name: 'Property slump', kind: 'hypothetical',
    description: 'Real-estate prices fall 25% after tax changes and tight liquidity.',
    shocks: { re: -25, psx: -5 },
  },
  {
    key: 'tech', name: 'Global tech sell-off', kind: 'hypothetical',
    description: 'Global stocks fall 30% led by technology; crypto halves; gold and Treasuries gain.',
    shocks: { gleq: -30, crypto: -50, psx: -8, gold: 8, glbond: 4, fx: 3 },
  },
  {
    key: 'crypto', name: 'Crypto winter', kind: 'hypothetical',
    description: 'Crypto falls 75% over a year, as in 2018 and 2022.',
    shocks: { crypto: -75, gleq: -5 },
  },
  {
    key: 'gold', name: 'Gold reversal', kind: 'hypothetical',
    description: 'Gold gives back a quarter of its value after its 2024–25 surge.',
    shocks: { gold: -25 },
  },
  {
    key: 'rally', name: 'Rate cuts and a PSX rally', kind: 'upside',
    description: 'Inflation eases, SBP cuts 4 points and PSX re-rates 40%, as in 2023–24.',
    shocks: { psx: 40, re: 10, rate: -4, cpi: -3, fx: -2 },
  },
];

const f = (s: Shocks, k: keyof Shocks) => (s[k] ?? 0) / 100;

/** Instant % change of a holding's PKR value under the shocks (fraction). */
export function holdingShock(h: Holding, s: Shocks): number {
  const fx = f(s, 'fx');
  const dRate = f(s, 'rate');
  const usd = (local: number) => (1 + local) * (1 + fx) - 1;
  const foreign = h.currency !== 'PKR';
  switch (h.type) {
    case 'psx_stock':
    case 'psx_etf': {
      const sector = h.sector ?? PSX_TICKERS.find((t) => t.ticker === h.ticker)?.sector;
      const beta = h.beta ?? (h.type === 'psx_etf' ? 1 : sectorDefaults(sector).beta);
      return Math.max(-1, beta * f(s, 'psx'));
    }
    case 'mutual_fund':
    case 'vps': {
      const c = fundCategory(h.type, h.sub);
      if (c.fixed) return 0;
      const mx = c.mix;
      return mx.eq * f(s, 'psx') + mx.income * (-1.5 * dRate) + mx.gold * usd(f(s, 'gold')) + mx.global * usd(f(s, 'gleq'));
    }
    case 'nss':
    case 'deposit':
    case 'cash':
      return 0;
    case 'govt_sec': {
      const g = GOVT_KINDS.find((k) => k.key === h.sub) ?? GOVT_KINDS[0];
      return -g.duration * dRate;
    }
    case 'fx_cash':
      return fx;
    case 'gold':
      return usd(f(s, 'gold'));
    case 'silver':
      return usd(1.3 * f(s, 'gold'));
    case 'property':
      return f(s, 're');
    case 'global_stock':
    case 'global_etf':
    case 'global_bond': {
      const t = globalTicker(h.ticker);
      const kind = h.type === 'global_bond' ? 'bond' : t?.kind ?? 'equity';
      const beta = h.beta ?? t?.beta ?? (h.type === 'global_stock' ? 1.1 : 1);
      const local = kind === 'equity' ? beta * f(s, 'gleq') : kind === 'bond' ? beta * f(s, 'glbond') : kind === 'gold' ? f(s, 'gold') : f(s, 'crypto');
      return usd(Math.max(-1, local));
    }
    case 'crypto': {
      const k = cryptoKind(h);
      if (k.stable) return fx;
      return usd(Math.max(-1, k.beta * f(s, 'crypto')));
    }
    case 'retirement':
      return -0.8 * dRate;
    case 'business':
      return 0.6 * f(s, 'psx');
    default:
      return foreign ? fx : 0;
  }
}

export interface StressResult {
  before: number;
  after: number;
  change: number;
  changePct: number;
  liabilityChange: number;
  byClass: { cls: AssetClass; before: number; change: number }[];
  holdings: { id: string; name: string; cls: AssetClass; before: number; change: number; pct: number }[];
}

export function runStress(holdings: Holding[], liabilities: Liability[], m: MarketSnapshot, s: Shocks): StressResult {
  const byClass = new Map<AssetClass, { before: number; change: number }>();
  const rows: StressResult['holdings'] = [];
  let before = 0, change = 0;
  for (const h of holdings) {
    const v = valuePKR(h, m);
    const pct = holdingShock(h, s);
    const d = v * pct;
    before += v;
    change += d;
    const c = holdingClass(h);
    const e = byClass.get(c) ?? { before: 0, change: 0 };
    e.before += v;
    e.change += d;
    byClass.set(c, e);
    rows.push({ id: h.id, name: h.ticker ? `${h.name} (${h.ticker})` : h.name, cls: c, before: v, change: d, pct });
  }
  const fx = f(s, 'fx');
  const liabBefore = liabilities.reduce((t, l) => t + liabilityPKR(l, m), 0);
  const liabilityChange = liabilities.reduce((t, l) => t + (l.currency !== 'PKR' ? liabilityPKR(l, m) * fx : 0), 0);
  const netBefore = before - liabBefore;
  const netChange = change - liabilityChange;
  rows.sort((a, b) => a.change - b.change);
  return {
    before: netBefore,
    after: netBefore + netChange,
    change: netChange,
    changePct: netBefore > 0 ? (netChange / netBefore) * 100 : 0,
    liabilityChange,
    byClass: CLASS_ORDER.filter((c) => byClass.has(c)).map((c) => ({ cls: c, ...byClass.get(c)! })),
    holdings: rows,
  };
}

/** Months to recover a loss at a given expected yearly return (%). */
export function recoveryMonths(lossPct: number, expectedPct: number): number | null {
  if (lossPct >= 0) return 0;
  if (expectedPct <= 0) return null;
  const need = 1 / (1 + lossPct / 100);
  return Math.ceil((Math.log(need) / Math.log(1 + expectedPct / 100)) * 12);
}
