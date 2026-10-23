// Class-level mean-variance optimisation, model portfolios, risk questionnaire and rebalancing trades.

import { syntheticAsset } from './exposures';
import { safeCholesky } from './linalg';
import { mean } from './linalg';
import type { SimInput, SimResult } from './simtypes';
import { cgtRate } from './tax';
import type { Assumptions, Holding, MarketSnapshot, OptClass, RiskProfile, Settings } from './types';
import { ASSET_FACTORS, OPT_CLASSES } from './types';
import { costPKR, liquidityOf, valuePKR } from './valuation';
import { optClassOf } from './exposures';

export const OPT_LABELS: Record<OptClass, string> = {
  pkfi: 'PKR fixed income',
  psx: 'PSX equities',
  gleq: 'Global equities',
  gold: 'Gold',
  usd: 'USD cash & bonds',
  crypto: 'Crypto',
};

export const OPT_HOWTO: Record<OptClass, { conventional: string; islamic: string }> = {
  pkfi: { conventional: 'Money market or income fund, T-bills through InvestPak, NSS for monthly income', islamic: 'Islamic money market or income fund, Sarwa Islamic accounts, GOP Ijara sukuk' },
  psx: { conventional: 'Low-cost index fund or PSX ETF, or 10+ stocks across sectors', islamic: 'Islamic equity fund or a KMI-tracking ETF such as MZNPETF' },
  gleq: { conventional: 'A world ETF such as VT or VWRA through a foreign broker, or a local international feeder fund', islamic: 'A Shariah-screened global ETF (for example SPUS or HLAL) or an Islamic international fund' },
  gold: { conventional: 'Gold bars or coins (avoid jewellery making charges) or a gold fund', islamic: 'Physical gold or an Islamic gold fund' },
  usd: { conventional: 'USD Naya Pakistan Certificates, an FCY deposit, or a short-term US T-bill ETF', islamic: 'Islamic Naya Pakistan Certificates or an Islamic FCY deposit' },
  crypto: { conventional: 'Bitcoin only, kept small, on a regulated platform', islamic: 'Scholars differ on crypto; many exclude it' },
};

export const MODEL_PORTFOLIOS: Record<RiskProfile, Record<OptClass, number>> = {
  conservative: { pkfi: 60, psx: 10, gleq: 5, gold: 10, usd: 15, crypto: 0 },
  moderate: { pkfi: 45, psx: 20, gleq: 12, gold: 10, usd: 13, crypto: 0 },
  balanced: { pkfi: 30, psx: 30, gleq: 20, gold: 10, usd: 8, crypto: 2 },
  growth: { pkfi: 15, psx: 40, gleq: 27, gold: 10, usd: 3, crypto: 5 },
  aggressive: { pkfi: 5, psx: 45, gleq: 35, gold: 5, usd: 0, crypto: 10 },
};

export const PROFILE_LABELS: Record<RiskProfile, string> = {
  conservative: 'Conservative',
  moderate: 'Moderate',
  balanced: 'Balanced',
  growth: 'Growth',
  aggressive: 'Aggressive',
};

export const PROFILE_ORDER: RiskProfile[] = ['conservative', 'moderate', 'balanced', 'growth', 'aggressive'];

export interface Question {
  key: string;
  text: string;
  options: { label: string; score: number }[];
}

export const RISK_QUESTIONS: Question[] = [
  { key: 'age', text: 'Your age', options: [{ label: 'Under 30', score: 4 }, { label: '30 to 44', score: 3 }, { label: '45 to 59', score: 2 }, { label: '60 or older', score: 0 }] },
  { key: 'horizon', text: 'When will you need most of this money?', options: [{ label: 'Within 3 years', score: 0 }, { label: 'In 3 to 7 years', score: 2 }, { label: 'In 7 to 15 years', score: 3 }, { label: 'After 15 years', score: 4 }] },
  { key: 'drop', text: 'Your portfolio falls 25% in a year. You would…', options: [{ label: 'Sell everything', score: 0 }, { label: 'Sell some', score: 1 }, { label: 'Hold and wait', score: 3 }, { label: 'Buy more', score: 4 }] },
  { key: 'income', text: 'How stable is your income?', options: [{ label: 'Unstable', score: 0 }, { label: 'Somewhat stable', score: 2 }, { label: 'Very stable', score: 3 }, { label: 'Stable, plus other income', score: 4 }] },
  { key: 'experience', text: 'Your investing experience', options: [{ label: 'None', score: 0 }, { label: 'Savings and NSS only', score: 1 }, { label: 'Mutual funds', score: 2 }, { label: 'Stocks or property', score: 3 }, { label: 'Active trading', score: 4 }] },
  { key: 'goal', text: 'Your main goal', options: [{ label: 'Protect capital', score: 0 }, { label: 'Steady income', score: 1 }, { label: 'Balanced growth', score: 2 }, { label: 'Long-term growth', score: 3 }, { label: 'Maximum growth', score: 4 }] },
  { key: 'emergency', text: 'Emergency savings', options: [{ label: 'None', score: 0 }, { label: 'Less than 3 months', score: 1 }, { label: '3 to 6 months', score: 3 }, { label: 'More than 6 months', score: 4 }] },
];

export function profileFromScore(score: number): RiskProfile {
  if (score <= 7) return 'conservative';
  if (score <= 12) return 'moderate';
  if (score <= 18) return 'balanced';
  if (score <= 23) return 'growth';
  return 'aggressive';
}

export function buildClassSim(a: Assumptions, m: MarketSnapshot, paths = 8000, seed = 2026): SimInput {
  const assets = OPT_CLASSES.map((c) => {
    const s = syntheticAsset(c, a);
    s.value0 = 1;
    s.investable = false;
    return s;
  });
  const { L } = safeCholesky(a.corr);
  return {
    months: 12,
    paths,
    seed,
    fCagr: ASSET_FACTORS.map((k) => a.factors[k].cagr),
    fVol: ASSET_FACTORS.map((k) => a.factors[k].vol),
    chol: L,
    macro: { ...a.macro, incomeSpread: a.spreads.income, incomeDuration: a.spreads.incomeDuration, mmfSpread: a.spreads.mmf },
    assets,
    plan: {
      sip: 0, stepUp: 0, lumps: [], withdrawals: [], goals: [], contribWeights: assets.map(() => 0), rebalance: 'none',
      rebalanceWeights: assets.map(() => 0), reinvestIncome: true, applyTax: false, applyZakat: false, nisab0: 0,
      liabilities: new Array(13).fill(0),
    },
    fx0: m.fx.USD,
    keepMonths: [],
    perClass: false,
    trackIncome: false,
    samplePaths: 0,
    recordAssetEnd: true,
  };
}

export interface ClassStats {
  mu: number[];
  cov: number[][];
  vol: number[];
}

export function classStats(res: SimResult): ClassStats {
  const n = OPT_CLASSES.length;
  const P = res.paths;
  const end = res.assetEnd!;
  const r = Array.from({ length: n }, () => new Float64Array(P));
  for (let p = 0; p < P; p++) for (let i = 0; i < n; i++) r[i][p] = end[p * n + i] - 1;
  const mu = r.map((x) => mean(x));
  const cov = r.map((ri, i) =>
    r.map((rj, j) => {
      let s = 0;
      for (let p = 0; p < P; p++) s += (ri[p] - mu[i]) * (rj[p] - mu[j]);
      return s / (P - 1);
    }),
  );
  return { mu, cov, vol: cov.map((row, i) => Math.sqrt(row[i])) };
}

export function portStats(w: number[], s: ClassStats): { ret: number; vol: number } {
  let ret = 0, v = 0;
  for (let i = 0; i < w.length; i++) {
    ret += w[i] * s.mu[i];
    for (let j = 0; j < w.length; j++) v += w[i] * s.cov[i][j] * w[j];
  }
  return { ret, vol: Math.sqrt(Math.max(0, v)) };
}

/** Project x onto {sum w = total, lb <= w <= ub}. */
function project(x: number[], lb: number[], ub: number[], total = 1): number[] {
  const sumLb = lb.reduce((a, b) => a + b, 0);
  const sumUb = ub.reduce((a, b) => a + b, 0);
  if (sumLb >= total) return lb.map((l) => (l * total) / (sumLb || 1));
  if (sumUb <= total) return ub.slice();
  let lo = Math.min(...x.map((xi, i) => xi - ub[i])) - 1;
  let hi = Math.max(...x.map((xi, i) => xi - lb[i])) + 1;
  for (let it = 0; it < 100; it++) {
    const tau = (lo + hi) / 2;
    const s = x.reduce((acc, xi, i) => acc + Math.min(ub[i], Math.max(lb[i], xi - tau)), 0);
    if (s > total) lo = tau;
    else hi = tau;
  }
  const tau = (lo + hi) / 2;
  return x.map((xi, i) => Math.min(ub[i], Math.max(lb[i], xi - tau)));
}

/** Maximise w'mu − (lambda/2) w'Σw under bounds. */
export function optimizeMV(s: ClassStats, lambda: number, lb: number[], ub: number[], start?: number[]): number[] {
  const n = s.mu.length;
  let w = project(start ?? new Array(n).fill(1 / n), lb, ub);
  const maxEig = Math.max(...s.cov.map((r) => r.reduce((a, b) => a + Math.abs(b), 0)));
  const eta = 1 / (lambda * maxEig + 1e-6);
  for (let it = 0; it < 3000; it++) {
    const grad = s.mu.map((m, i) => m - lambda * s.cov[i].reduce((acc, c, j) => acc + c * w[j], 0));
    const next = project(w.map((wi, i) => wi + eta * grad[i]), lb, ub);
    let d = 0;
    for (let i = 0; i < n; i++) d += Math.abs(next[i] - w[i]);
    w = next;
    if (d < 1e-9) break;
  }
  return w;
}

export interface FrontierPoint {
  w: number[];
  ret: number;
  vol: number;
  sharpe: number;
}

export function efficientFrontier(s: ClassStats, lb: number[], ub: number[], rf: number): { points: FrontierPoint[]; maxSharpe: FrontierPoint; minVol: FrontierPoint } {
  type P = FrontierPoint & { lam: number };
  const solve = (lam: number, start?: number[]): P => {
    const w = optimizeMV(s, lam, lb, ub, start);
    const st = portStats(w, s);
    return { lam, w, ...st, sharpe: st.vol > 0 ? (st.ret - rf) / st.vol : 0 };
  };
  // Sweep risk aversion from high (low risk) to low (high risk), warm-starting each solve.
  let pts: P[] = [];
  let prev: number[] | undefined;
  for (let k = 0; k <= 24; k++) {
    const p = solve(Math.pow(10, 4 - k * (5 / 24)), prev); // 10^4 → 10^-1
    prev = p.w;
    pts.push(p);
  }
  // Fill gaps where the mix changes quickly, so the curve and "same risk" picks are accurate.
  for (let pass = 0; pass < 6; pass++) {
    let inserted = false;
    const next: P[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (Math.abs(b.vol - a.vol) > 0.005 && a.lam / b.lam > 1.001) {
        next.push(solve(Math.sqrt(a.lam * b.lam), a.w));
        inserted = true;
      }
      next.push(b);
    }
    pts = next;
    if (!inserted) break;
  }
  const points: FrontierPoint[] = [];
  for (const p of pts.sort((a, b) => a.vol - b.vol)) {
    const last = points[points.length - 1];
    if (last && Math.abs(last.vol - p.vol) < 1e-4 && Math.abs(last.ret - p.ret) < 1e-4) continue;
    if (last && p.ret < last.ret - 1e-6) continue; // keep the efficient (upward) branch only
    points.push({ w: p.w, ret: p.ret, vol: p.vol, sharpe: p.sharpe });
  }
  const maxSharpe = points.reduce((b, p) => (p.sharpe > b.sharpe ? p : b), points[0]);
  const minVol = points[0];
  return { points, maxSharpe, minVol };
}

/** The highest-return mix whose volatility does not exceed `targetVol` (bisection on risk aversion). */
export function optimizeForVol(s: ClassStats, lb: number[], ub: number[], targetVol: number): FrontierPoint {
  const at = (lam: number, start?: number[]) => {
    const w = optimizeMV(s, lam, lb, ub, start);
    return { w, ...portStats(w, s), sharpe: 0 };
  };
  let hiRisk = at(0.05);
  if (hiRisk.vol <= targetVol) return hiRisk;
  let loRisk = at(1e4);
  if (loRisk.vol >= targetVol) return loRisk;
  let a = Math.log10(0.05), b = 4; // vol falls as log10(lambda) rises
  let best = loRisk;
  for (let i = 0; i < 36; i++) {
    const mid = (a + b) / 2;
    const p = at(Math.pow(10, mid), best.w);
    if (p.vol <= targetVol + 1e-5) {
      if (p.ret > best.ret) best = p;
      b = mid;
    } else a = mid;
  }
  return best;
}

export interface CurrentMix {
  /** PKR value by optimizer class (liquid and investable holdings only). */
  values: Record<OptClass, number>;
  total: number;
  weights: number[];
  /** Value excluded from optimisation (property, locked, other). */
  locked: number;
}

export function currentMix(holdings: Holding[], m: MarketSnapshot): CurrentMix {
  const values = Object.fromEntries(OPT_CLASSES.map((c) => [c, 0])) as Record<OptClass, number>;
  let locked = 0;
  for (const h of holdings) {
    const v = valuePKR(h, m);
    const oc = optClassOf(h);
    const l = liquidityOf(h);
    if (!oc || l === 'months' || (l === 'locked' && h.type !== 'vps')) {
      locked += v;
      continue;
    }
    values[oc] += v;
  }
  const total = OPT_CLASSES.reduce((s, c) => s + values[c], 0);
  return { values, total, weights: OPT_CLASSES.map((c) => (total > 0 ? values[c] / total : 0)), locked };
}

export interface Trade {
  cls: OptClass;
  current: number;
  target: number;
  trade: number;
  estTax: number;
}

export function rebalanceTrades(
  holdings: Holding[], mix: CurrentMix, target: Record<OptClass, number>, m: MarketSnapshot, settings: Settings, today: string,
): { trades: Trade[]; totalTax: number } {
  const tSum = OPT_CLASSES.reduce((s, c) => s + (target[c] ?? 0), 0) || 1;
  const trades = OPT_CLASSES.map((c) => {
    const tgt = ((target[c] ?? 0) / tSum) * mix.total;
    const trade = tgt - mix.values[c];
    let estTax = 0;
    if (trade < 0 && mix.values[c] > 0) {
      const frac = Math.min(1, -trade / mix.values[c]);
      for (const h of holdings) {
        if (optClassOf(h) !== c) continue;
        const cost = costPKR(h, m);
        if (cost === undefined) continue;
        const gain = valuePKR(h, m) - cost;
        if (gain > 0) estTax += gain * frac * cgtRate(h, settings.filer, today, settings.foreignCgtRate);
      }
    }
    return { cls: c, current: mix.values[c], target: tgt, trade, estTax };
  });
  return { trades, totalTax: trades.reduce((s, t) => s + t.estTax, 0) };
}
