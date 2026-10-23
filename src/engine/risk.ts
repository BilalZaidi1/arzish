// Risk analytics from a one-year, no-cash-flow simulation of the current holdings.

import { buildSim, syntheticAsset } from './exposures';
import { mean, percentileSorted, stdev } from './linalg';
import type { SimInput, SimResult } from './simtypes';
import type { AssetClass, Assumptions, Holding, MarketSnapshot, Portfolio, Settings } from './types';
import { CLASS_ORDER } from './types';
import { valuePKR } from './valuation';

export interface RiskBuild {
  input: SimInput;
  nHold: number;
  ids: string[];
  names: string[];
  classes: number[];
  values: number[];
}

export function buildRiskSim(
  p: Portfolio, holdings: Holding[], ws: { settings: Settings; market: MarketSnapshot; assumptions: Assumptions },
  paths = 5000, months = 12,
): RiskBuild {
  const built = buildSim(p, holdings, ws, {
    noFlows: true, monthsOverride: months, paths, perClass: false, trackIncome: false,
    includeGoals: false, includeRetirement: false, seed: (p.plan.seed || 7) + 101,
  });
  const input = built.input;
  const nHold = input.assets.length;
  // Benchmarks with negligible value: PSX index and S&P 500 in PKR.
  const kse = syntheticAsset('psx', ws.assumptions);
  kse.id = '__bench_kse';
  kse.mu = Math.log(1 + ws.assumptions.factors.psx.cagr / 100) / 12;
  kse.idio = 0;
  kse.value0 = 1e-6;
  const spx = syntheticAsset('gleq', ws.assumptions);
  spx.id = '__bench_spx';
  spx.mu = Math.log(1 + ws.assumptions.factors.gleq.cagr / 100) / 12;
  spx.idio = 0;
  spx.value0 = 1e-6;
  input.assets.push(kse, spx);
  input.plan.contribWeights = [...input.plan.contribWeights, 0, 0];
  input.plan.rebalanceWeights = [...input.plan.rebalanceWeights, 0, 0];
  input.plan.rebalance = 'none';
  input.plan.reinvestIncome = true;
  input.plan.applyTax = false;
  input.plan.applyZakat = false;
  input.plan.withdrawals = [];
  input.recordAssetEnd = true;
  input.keepMonths = [];
  return {
    input,
    nHold,
    ids: input.assets.slice(0, nHold).map((a) => a.id),
    names: input.assets.slice(0, nHold).map((a) => a.name),
    classes: input.assets.slice(0, nHold).map((a) => a.cls),
    values: input.assets.slice(0, nHold).map((a) => a.value0),
  };
}

export interface RiskReport {
  paths: number;
  total: number;
  mean: number;
  sd: number;
  var95: number;
  cvar95: number;
  probLoss: number;
  probBelowInflation: number;
  rf: number;
  sharpe: number;
  sortino: number;
  betaKse: number;
  betaSpx: number;
  corrKse: number;
  classes: { cls: AssetClass; weight: number; riskContrib: number; vol: number; ret: number }[];
  corr: { classes: AssetClass[]; matrix: number[][] };
  top: { id: string; name: string; weight: number; riskContrib: number; vol: number }[];
  returns: Float64Array;
  /** Largest peak-to-trough fall within the horizon: median and 1-in-10 worst. */
  maxDD: { median: number; p90: number };
  months: number;
}

function cov(a: Float64Array, b: Float64Array, ma: number, mb: number): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return a.length > 1 ? s / (a.length - 1) : 0;
}

export function analyzeRisk(rb: RiskBuild, res: SimResult, rfPct: number, inflationPct: number): RiskReport {
  const P = res.paths;
  const nA = rb.input.assets.length;
  const end = res.assetEnd!;
  const nH = rb.nHold;
  const total = rb.values.reduce((s, x) => s + x, 0);
  const rp = new Float64Array(P);
  const rk = new Float64Array(P);
  const rs = new Float64Array(P);
  const presentCls = CLASS_ORDER.map((_, c) => rb.values.reduce((s, v, i) => s + (rb.classes[i] === c ? v : 0), 0));
  const clsIdx = presentCls.map((v, c) => (v > 0 ? c : -1)).filter((c) => c >= 0);
  const rc = clsIdx.map(() => new Float64Array(P));
  const ra = Array.from({ length: nH }, () => new Float64Array(P));
  for (let p = 0; p < P; p++) {
    let tot = 0;
    const clsEnd = new Array(8).fill(0);
    for (let i = 0; i < nH; i++) {
      const e = end[p * nA + i];
      tot += e;
      clsEnd[rb.classes[i]] += e;
      ra[i][p] = rb.values[i] > 0 ? e / rb.values[i] - 1 : 0;
    }
    rp[p] = total > 0 ? tot / total - 1 : 0;
    rk[p] = end[p * nA + nH] / 1e-6 - 1;
    rs[p] = end[p * nA + nH + 1] / 1e-6 - 1;
    clsIdx.forEach((c, j) => (rc[j][p] = presentCls[c] > 0 ? clsEnd[c] / presentCls[c] - 1 : 0));
  }
  const m = mean(rp);
  const sd = stdev(rp);
  const sorted = Float64Array.from(rp).sort();
  const p5 = percentileSorted(sorted, 0.05);
  let tail = 0, tn = 0;
  for (let i = 0; i < P; i++) if (rp[i] <= p5) { tail += rp[i]; tn++; }
  const cvar = tn ? -(tail / tn) : -p5;
  let loss = 0, belowInfl = 0, down = 0;
  const rf = rfPct / 100;
  for (let i = 0; i < P; i++) {
    if (rp[i] < 0) loss++;
    if (rp[i] < inflationPct / 100) belowInfl++;
    if (rp[i] < rf) down += (rp[i] - rf) * (rp[i] - rf);
  }
  const downDev = Math.sqrt(down / Math.max(1, P - 1));
  const mk = mean(rk), ms = mean(rs);
  const vk = cov(rk, rk, mk, mk), vs = cov(rs, rs, ms, ms);
  const cpk = cov(rp, rk, m, mk), cps = cov(rp, rs, m, ms);

  // Class covariance and Euler risk contributions
  const means = rc.map((r) => mean(r));
  const C = rc.map((ri, i) => rc.map((rj, j) => cov(ri, rj, means[i], means[j])));
  const w = clsIdx.map((c) => presentCls[c] / total);
  const Sw = C.map((row) => row.reduce((s, x, j) => s + x * w[j], 0));
  const varP = w.reduce((s, wi, i) => s + wi * Sw[i], 0);
  const classes = clsIdx.map((c, i) => ({
    cls: CLASS_ORDER[c],
    weight: w[i],
    riskContrib: varP > 0 ? (w[i] * Sw[i]) / varP : 0,
    vol: Math.sqrt(Math.max(0, C[i][i])),
    ret: means[i],
  }));
  const corrM = C.map((row, i) => row.map((x, j) => {
    const d = Math.sqrt(C[i][i] * C[j][j]);
    return d > 0 ? x / d : i === j ? 1 : 0;
  }));
  const top = ra
    .map((r, i) => {
      const mi = mean(r);
      const c = cov(r, rp, mi, m);
      const wi = total > 0 ? rb.values[i] / total : 0;
      return { id: rb.ids[i], name: rb.names[i], weight: wi, riskContrib: sd > 0 ? (wi * c) / (sd * sd) : 0, vol: stdev(r) };
    })
    .sort((a, b) => b.riskContrib - a.riskContrib);
  return {
    paths: P,
    total,
    mean: m,
    sd,
    var95: -p5,
    cvar95: cvar,
    probLoss: loss / P,
    probBelowInflation: belowInfl / P,
    rf,
    sharpe: sd > 0 ? (m - rf) / sd : 0,
    sortino: downDev > 0 ? (m - rf) / downDev : 0,
    betaKse: vk > 0 ? cpk / vk : 0,
    betaSpx: vs > 0 ? cps / vs : 0,
    corrKse: vk > 0 && sd > 0 ? cpk / Math.sqrt(vk) / sd : 0,
    classes,
    corr: { classes: clsIdx.map((c) => CLASS_ORDER[c]), matrix: corrM },
    top,
    returns: rp,
    maxDD: res.maxDD,
    months: res.months,
  };
}

export interface Concentration {
  top1: { name: string; weight: number } | null;
  top5: number;
  hhi: number;
  effectiveN: number;
  topSector: { name: string; weight: number } | null;
}

export function concentration(holdings: Holding[], m: MarketSnapshot, sectorOf: (h: Holding) => string): Concentration {
  const vals = holdings.map((h) => ({ h, v: valuePKR(h, m) })).filter((x) => x.v > 0);
  const total = vals.reduce((s, x) => s + x.v, 0);
  if (total <= 0) return { top1: null, top5: 0, hhi: 0, effectiveN: 0, topSector: null };
  vals.sort((a, b) => b.v - a.v);
  const hhi = vals.reduce((s, x) => s + (x.v / total) ** 2, 0);
  const psx = vals.filter((x) => x.h.type === 'psx_stock');
  const psxTot = psx.reduce((s, x) => s + x.v, 0);
  let topSector: Concentration['topSector'] = null;
  if (psxTot > 0) {
    const bySec: Record<string, number> = {};
    psx.forEach((x) => (bySec[sectorOf(x.h)] = (bySec[sectorOf(x.h)] ?? 0) + x.v));
    const [name, v] = Object.entries(bySec).sort((a, b) => b[1] - a[1])[0];
    topSector = { name, weight: v / psxTot };
  }
  return {
    top1: { name: vals[0].h.ticker ? `${vals[0].h.name} (${vals[0].h.ticker})` : vals[0].h.name, weight: vals[0].v / total },
    top5: vals.slice(0, 5).reduce((s, x) => s + x.v, 0) / total,
    hhi,
    effectiveN: hhi > 0 ? 1 / hhi : 0,
    topSector,
  };
}

/** Histogram with geometrically spaced bins (for long-tailed wealth outcomes). Values at or
 *  below zero are counted in the first bin. */
export function logHistogram(values: ArrayLike<number>, bins = 36): { edges: number[]; counts: number[] } {
  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  const positive = sorted.filter((v) => v > 0);
  if (positive.length < sorted.length * 0.5) return histogram(values, bins);
  const lo = Math.max(percentileSorted(sorted, 0.01), positive[0]);
  const hi = Math.max(lo * 1.01, percentileSorted(sorted, 0.99));
  const la = Math.log(lo), lb = Math.log(hi);
  const step = (lb - la) / bins;
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < sorted.length; i++) {
    const x = sorted[i];
    if (x > hi) continue;
    const k = x <= lo ? 0 : Math.min(bins - 1, Math.floor((Math.log(x) - la) / step));
    counts[k]++;
  }
  const edges = Array.from({ length: bins + 1 }, (_, i) => Math.exp(la + i * step));
  return { edges, counts };
}

/** Histogram with equal-width bins between the 1st and 99th percentiles. */
export function histogram(values: ArrayLike<number>, bins = 40, lo?: number, hi?: number): { edges: number[]; counts: number[] } {
  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  const a = lo ?? percentileSorted(sorted, 0.01);
  const b = hi ?? percentileSorted(sorted, 0.99);
  const width = (b - a) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < sorted.length; i++) {
    const x = sorted[i];
    if (x < a || x > b) continue;
    const k = Math.min(bins - 1, Math.floor((x - a) / width));
    counts[k]++;
  }
  const edges = Array.from({ length: bins + 1 }, (_, i) => a + i * width);
  return { edges, counts };
}
