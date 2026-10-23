// Maps holdings onto the simulation's factor model and builds SimInput from a portfolio.

import { CRYPTO_KINDS, GOVT_KINDS, fundCategory, nssProduct } from './catalog';
import { addMonthsISO, monthsBetween, todayISO } from './format';
import { safeCholesky } from './linalg';
import type { SimAsset, SimInput, SimPlan } from './simtypes';
import { cgtRate, incomeTaxRate, nisabPKR, rentTax, zakatableFraction } from './tax';
import type { Assumptions, Holding, MarketSnapshot, OptClass, Portfolio, Settings } from './types';
import { ASSET_FACTORS, CLASS_ORDER, OPT_CLASSES } from './types';
import {
  costPKR, cryptoKind, globalTicker, holdingClass, isInvestable, isLiquid, rateOf, sectorDefaults, valuePKR,
} from './valuation';
import { PSX_TICKERS } from './catalog';

const SQRT12 = Math.sqrt(12);
const mLog = (pct: number) => Math.log(1 + pct / 100) / 12;

function baseAsset(h: { id: string; name: string }, cls: number, value: number, cost: number): SimAsset {
  return {
    id: h.id,
    name: h.name,
    cls,
    opt: -1,
    value0: value,
    cost0: cost,
    kind: 'factor',
    mu: 0,
    load: [0, 0, 0, 0, 0, 0],
    idio: 0,
    fx: 0,
    cross: 0,
    jumpPsx: 0,
    spread: 0,
    duration: 0,
    ter: 0,
    coupon: 0,
    maturityMonth: 0,
    reinvestSpread: 0,
    mix: [0, 0, 0, 0, 0],
    yieldAnnual: 0,
    paysIncome: false,
    incomeTax: 0,
    rent0: 0,
    rentTaxRate: 0,
    liquid: true,
    investable: true,
    zakatable: 0,
    cgtRate: 0,
  };
}

/** Which optimizer class a holding belongs to (-1 = not optimised, e.g. property). */
export function optClassOf(h: Holding): OptClass | null {
  switch (h.type) {
    case 'psx_stock':
    case 'psx_etf':
      return 'psx';
    case 'mutual_fund':
    case 'vps': {
      const c = fundCategory(h.type, h.sub);
      const m = c.mix;
      const best = Math.max(m.eq, m.income + m.cash, m.gold, m.global);
      if (best === m.eq) return 'psx';
      if (best === m.gold) return 'gold';
      if (best === m.global) return 'gleq';
      return 'pkfi';
    }
    case 'nss':
    case 'govt_sec':
    case 'deposit':
    case 'cash':
      return 'pkfi';
    case 'fx_cash':
    case 'global_bond':
      return 'usd';
    case 'gold':
    case 'silver':
      return 'gold';
    case 'global_stock':
    case 'global_etf': {
      const t = globalTicker(h.ticker);
      if (t?.kind === 'gold') return 'gold';
      if (t?.kind === 'crypto') return 'crypto';
      if (t?.kind === 'bond') return 'usd';
      return 'gleq';
    }
    case 'crypto':
      return cryptoKind(h).stable ? 'usd' : 'crypto';
    default:
      return null;
  }
}

export interface MapContext {
  a: Assumptions;
  m: MarketSnapshot;
  settings: Settings;
  today: string;
}

/** Expected median CAGR for a PSX stock given its beta (CAPM-style around the long-run rate). */
function psxCagr(beta: number, a: Assumptions): number {
  const rf = a.macro.rateLR;
  return rf + beta * (a.factors.psx.cagr - rf);
}

function idioFromOverride(totalVol: number | undefined, systematic: number, fallback: number): number {
  if (totalVol === undefined || !isFinite(totalVol)) return fallback;
  return Math.sqrt(Math.max(0, totalVol * totalVol - systematic * systematic));
}

export function holdingToSimAsset(h: Holding, ctx: MapContext): SimAsset {
  const { a, m, settings } = ctx;
  const value = valuePKR(h, m);
  const cost = costPKR(h, m) ?? value;
  const cls = CLASS_ORDER.indexOf(holdingClass(h));
  const s = baseAsset(h, cls, value, cost);
  const oc = optClassOf(h);
  s.opt = oc ? OPT_CLASSES.indexOf(oc) : -1;
  s.liquid = isLiquid(h);
  s.investable = isInvestable(h);
  s.zakatable = zakatableFraction(h);
  s.cgtRate = cgtRate(h, settings.filer, ctx.today, settings.foreignCgtRate);
  s.incomeTax = incomeTaxRate(h, settings.filer);
  const foreign = h.currency !== 'PKR';
  if (foreign) {
    s.fx = 1;
    if (h.currency === 'GBP' || h.currency === 'EUR') s.cross = 0.08 / SQRT12;
  }
  const r0 = a.macro.rate0;
  const months = (iso?: string) => (iso ? Math.max(0, monthsBetween(ctx.today, iso)) : 0);

  switch (h.type) {
    case 'psx_stock':
    case 'psx_etf': {
      const sector = h.sector ?? PSX_TICKERS.find((t) => t.ticker === h.ticker)?.sector;
      const beta = h.beta ?? (h.type === 'psx_etf' ? 1 : sectorDefaults(sector).beta);
      const g = h.expReturn ?? psxCagr(beta, a);
      s.kind = 'factor';
      s.mu = mLog(g - (h.type === 'psx_etf' ? 0.8 : 0));
      s.load[0] = beta;
      const sys = beta * a.factors.psx.vol;
      s.idio = idioFromOverride(h.vol, sys, h.type === 'psx_etf' ? 3 : 24) / 100 / SQRT12;
      s.jumpPsx = beta;
      s.yieldAnnual = (h.yieldPct ?? (h.type === 'psx_etf' ? 7 : sectorDefaults(sector).dy)) / 100;
      break;
    }
    case 'mutual_fund':
    case 'vps': {
      const c = fundCategory(h.type, h.sub);
      s.ter = h.ter ?? c.ter;
      if (c.fixed) {
        s.kind = 'fixed';
        s.coupon = h.rate ?? m.tbill.m12 - s.ter;
        s.ter = 0;
        s.maturityMonth = months(h.maturity) || 24;
        s.reinvestSpread = a.spreads.mmf - 1;
      } else {
        s.kind = 'mix';
        const mx = c.mix;
        s.mix = [mx.eq, mx.income, mx.cash, mx.gold, mx.global];
        if (c.incomeSpread) s.spread = c.incomeSpread;
      }
      s.yieldAnnual = (h.payout && h.payout !== 'none' ? h.yieldPct ?? 0 : 0) / 100;
      if (h.expReturn !== undefined) {
        s.kind = 'factor';
        s.mu = mLog(h.expReturn - s.ter);
        s.load[0] = c.mix.eq;
        s.idio = (h.vol ?? 0) / 100 / SQRT12;
        s.jumpPsx = c.mix.eq;
      }
      break;
    }
    case 'nss': {
      const p = nssProduct(h.sub);
      const rate = rateOf(h, m);
      if (p.years === 0) {
        s.kind = 'rate';
        s.spread = rate - r0;
        s.paysIncome = p.payout !== 'none';
      } else {
        s.kind = 'fixed';
        s.coupon = rate;
        const mat = h.maturity ?? (h.purchaseDate ? addMonthsISO(h.purchaseDate, p.years * 12) : addMonthsISO(ctx.today, p.years * 12));
        s.maturityMonth = Math.max(0, months(mat));
        s.reinvestSpread = a.spreads.nssReinvest;
        s.paysIncome = p.payout !== 'maturity' && p.payout !== 'none';
      }
      if (h.sub === 'PRIZE') {
        s.kind = 'zero';
        s.paysIncome = false;
      }
      break;
    }
    case 'govt_sec': {
      const g = GOVT_KINDS.find((k) => k.key === h.sub) ?? GOVT_KINDS[0];
      const rate = rateOf(h, m);
      if (g.key === 'pib_fixed') {
        s.kind = 'fixed';
        s.coupon = rate;
        s.maturityMonth = months(h.maturity) || 60;
        s.duration = g.duration;
        s.reinvestSpread = 0;
      } else {
        s.kind = 'rate';
        s.spread = rate - r0;
        s.duration = g.duration;
      }
      s.paysIncome = g.payout !== 'maturity';
      break;
    }
    case 'deposit': {
      const rate = rateOf(h, m);
      if (rate <= 0) s.kind = 'zero';
      else {
        s.kind = 'rate';
        s.spread = rate - r0;
        s.paysIncome = true;
      }
      break;
    }
    case 'cash':
      s.kind = 'zero';
      break;
    case 'fx_cash': {
      const rate = rateOf(h, m);
      s.kind = 'factor';
      s.mu = mLog(rate);
      s.yieldAnnual = rate / 100;
      break;
    }
    case 'gold':
    case 'silver': {
      s.kind = 'factor';
      s.fx = 1;
      const silver = h.type === 'silver';
      s.mu = mLog(h.expReturn ?? a.factors.gold.cagr);
      s.load[3] = silver ? 1.3 : 1;
      s.idio = (silver ? 15 : 1.5) / 100 / SQRT12;
      break;
    }
    case 'property': {
      s.kind = 'factor';
      s.mu = mLog(h.expReturn ?? a.factors.re.cagr);
      s.load[4] = 1;
      s.idio = idioFromOverride(h.vol, a.factors.re.vol, 8) / 100 / SQRT12;
      const gross = (h.rentMonthly ?? 0) * (1 - (h.vacancyPct ?? 0) / 100);
      const net = gross - (h.costsAnnual ?? 0) / 12;
      s.rent0 = net * (m.fx[h.currency] ?? 1);
      const annualGross = gross * 12 * (m.fx[h.currency] ?? 1);
      s.rentTaxRate = s.rent0 > 0 && annualGross > 0 ? rentTax(annualGross) / 12 / s.rent0 : 0;
      break;
    }
    case 'global_stock':
    case 'global_etf':
    case 'global_bond': {
      const t = globalTicker(h.ticker);
      const kind = h.type === 'global_bond' ? 'bond' : t?.kind ?? 'equity';
      const beta = h.beta ?? t?.beta ?? (h.type === 'global_stock' ? 1.1 : 1);
      s.kind = 'factor';
      s.fx = 1;
      if (h.currency === 'GBP' || h.currency === 'EUR') s.cross = 0.08 / SQRT12;
      if (kind === 'equity') {
        const rf = a.macro.usdRate;
        const g = h.expReturn ?? rf + beta * (a.factors.gleq.cagr - rf);
        s.mu = mLog(g - (h.type === 'global_etf' ? 0.1 : 0));
        s.load[1] = beta;
        const fallbackIdio = t?.idio ?? (h.type === 'global_stock' ? 25 : 2);
        s.idio = idioFromOverride(h.vol, beta * a.factors.gleq.vol, fallbackIdio) / 100 / SQRT12;
      } else if (kind === 'bond') {
        s.mu = mLog(h.expReturn ?? a.factors.glbond.cagr);
        s.load[2] = beta;
        s.idio = 0.5 / 100 / SQRT12;
      } else if (kind === 'gold') {
        s.mu = mLog(h.expReturn ?? a.factors.gold.cagr - 0.25);
        s.load[3] = 1;
      } else {
        s.mu = mLog(h.expReturn ?? a.factors.crypto.cagr - 0.25);
        s.load[5] = 1;
      }
      s.yieldAnnual = (h.yieldPct ?? t?.dy ?? (kind === 'bond' ? 4 : 1.5)) / 100;
      break;
    }
    case 'crypto': {
      const k = cryptoKind(h);
      s.kind = 'factor';
      s.fx = 1;
      if (k.stable) {
        s.mu = mLog(h.yieldPct ?? 0);
        s.yieldAnnual = (h.yieldPct ?? 0) / 100;
      } else {
        s.mu = mLog(h.expReturn ?? a.factors.crypto.cagr);
        s.load[5] = k.beta;
        s.idio = idioFromOverride(h.vol, k.beta * a.factors.crypto.vol, k.idio) / 100 / SQRT12;
      }
      break;
    }
    case 'retirement': {
      s.kind = 'rate';
      s.spread = h.rate !== undefined ? h.rate - r0 : a.spreads.retirement;
      s.duration = 0.8;
      break;
    }
    case 'business': {
      s.kind = 'factor';
      s.mu = mLog(h.expReturn ?? 15);
      s.load[0] = 0.6;
      s.idio = idioFromOverride(h.vol, 0.6 * a.factors.psx.vol, 28) / 100 / SQRT12;
      s.jumpPsx = 0.6;
      s.yieldAnnual = (h.yieldPct ?? 0) / 100;
      break;
    }
    case 'custom':
    default: {
      s.kind = 'factor';
      s.mu = mLog(h.expReturn ?? 10);
      s.idio = (h.vol ?? 12) / 100 / SQRT12;
      s.yieldAnnual = (h.yieldPct ?? 0) / 100;
      break;
    }
  }
  return s;
}

/** Synthetic class-level assets used for contributions to classes the investor does not hold yet. */
export function syntheticAsset(c: OptClass, a: Assumptions): SimAsset {
  const id = `__syn_${c}`;
  const labels: Record<OptClass, string> = {
    pkfi: 'New money: PKR money market', psx: 'New money: PSX index fund', gleq: 'New money: global equity ETF',
    gold: 'New money: gold', usd: 'New money: USD cash', crypto: 'New money: bitcoin',
  };
  const clsMap: Record<OptClass, number> = { pkfi: 2, psx: 0, gleq: 5, gold: 3, usd: 2, crypto: 6 };
  const s = baseAsset({ id, name: labels[c] }, clsMap[c], 0, 0);
  s.synthetic = true;
  s.opt = OPT_CLASSES.indexOf(c);
  s.zakatable = 1;
  switch (c) {
    case 'pkfi':
      s.kind = 'rate';
      s.spread = a.spreads.mmf;
      s.ter = 1.0;
      s.incomeTax = 0;
      break;
    case 'psx':
      s.kind = 'factor';
      s.mu = mLog(a.factors.psx.cagr - 1.5);
      s.load[0] = 1;
      s.idio = 0.02 / SQRT12;
      s.jumpPsx = 1;
      break;
    case 'gleq':
      s.kind = 'factor';
      s.fx = 1;
      s.mu = mLog(a.factors.gleq.cagr - 0.2);
      s.load[1] = 1;
      s.idio = 0.02 / SQRT12;
      s.yieldAnnual = 0;
      break;
    case 'gold':
      s.kind = 'factor';
      s.fx = 1;
      s.mu = mLog(a.factors.gold.cagr);
      s.load[3] = 1;
      s.idio = 0.015 / SQRT12;
      break;
    case 'usd':
      s.kind = 'factor';
      s.fx = 1;
      s.mu = mLog(a.macro.usdRate);
      s.yieldAnnual = 0;
      break;
    case 'crypto':
      s.kind = 'factor';
      s.fx = 1;
      s.mu = mLog(a.factors.crypto.cagr);
      s.load[5] = 1;
      break;
  }
  return s;
}

export const BALANCED_FALLBACK: Partial<Record<OptClass, number>> = { pkfi: 40, psx: 35, gold: 10, gleq: 15 };

export interface BuildOptions {
  horizonYears?: number;
  paths?: number;
  seed?: number;
  sipMonthly?: number;
  sipStepUp?: number;
  mixOverride?: Partial<Record<OptClass, number>>;
  rebalance?: Portfolio['plan']['rebalance'];
  contributionMix?: Portfolio['plan']['contributionMix'];
  extraWithdrawalMonthly?: number;
  /** Apply instantaneous shocks to starting values. */
  startShock?: (h: Holding) => number;
  perClass?: boolean;
  trackIncome?: boolean;
  samplePaths?: number;
  includeGoals?: boolean;
  includeRetirement?: boolean;
  assumptions?: Assumptions;
  noFlows?: boolean;
  /** Override the horizon in months (risk analytics). */
  monthsOverride?: number;
}

export interface BuiltSim {
  input: SimInput;
  months: number;
  goalKeep: Record<string, number>;
  horizonKeep: number;
  cholRepaired: boolean;
  startNet: number;
}

function normalize(w: number[]): number[] {
  const s = w.reduce((a, b) => a + b, 0);
  return s > 0 ? w.map((x) => x / s) : w.map(() => 0);
}

/** Weights over assets that realise class targets, using existing investable holdings, else synthetics. */
function classTargetWeights(assets: SimAsset[], target: Partial<Record<OptClass, number>>, a: Assumptions): number[] {
  const t = OPT_CLASSES.map((c) => Math.max(0, target[c] ?? 0));
  const tSum = t.reduce((x, y) => x + y, 0) || 1;
  const w = new Array(assets.length).fill(0);
  OPT_CLASSES.forEach((c, ci) => {
    const share = t[ci] / tSum;
    if (share <= 0) return;
    const members = assets.map((s, i) => ({ s, i })).filter(({ s }) => s.investable && s.opt === ci && !s.synthetic);
    const tot = members.reduce((x, { s }) => x + s.value0, 0);
    if (members.length && tot > 0) members.forEach(({ s, i }) => (w[i] += (share * s.value0) / tot));
    else {
      let idx = assets.findIndex((s) => s.synthetic && s.opt === ci);
      if (idx < 0) {
        assets.push(syntheticAsset(c, a));
        w.push(0);
        idx = assets.length - 1;
      }
      w[idx] += share;
    }
  });
  return w;
}

export function buildSim(p: Portfolio, holdings: Holding[], ws: { settings: Settings; market: MarketSnapshot; assumptions: Assumptions }, o: BuildOptions = {}): BuiltSim {
  const a = o.assumptions ?? ws.assumptions;
  const m = ws.market;
  const today = todayISO();
  const ctx: MapContext = { a, m, settings: ws.settings, today };
  const plan = p.plan;
  const assets: SimAsset[] = holdings.map((h) => {
    const s = holdingToSimAsset(h, ctx);
    if (o.startShock) s.value0 = Math.max(0, s.value0 * (1 + o.startShock(h)));
    return s;
  });

  const horizonYears = o.horizonYears ?? plan.horizonYears;
  let months = o.monthsOverride ?? Math.round(horizonYears * 12);
  const includeGoals = o.includeGoals ?? true;
  const goals = includeGoals
    ? p.goals
        .map((g) => ({ id: g.id, month: monthsBetween(today, g.date), amountToday: g.target, inflation: g.inflation, withdraw: g.withdraw }))
        .filter((g) => g.month > 0 && g.month <= 720)
    : [];
  let retirement: SimPlan['retirement'];
  const r = plan.retirement;
  if ((o.includeRetirement ?? true) && r.enabled && r.retireAge >= r.age && r.lifeAge > r.retireAge) {
    const start = Math.round((r.retireAge - r.age) * 12);
    const end = Math.round((r.lifeAge - r.age) * 12);
    const monthly = Math.max(0, r.monthlyNeed - r.pension);
    retirement = { start, end, monthly };
  }
  if (!o.monthsOverride) {
    // The horizon is what the user chose; goals beyond it are still simulated.
    const goalMax = goals.reduce((mx, g) => Math.max(mx, g.month), 0);
    months = Math.max(months, goalMax);
    if (retirement) months = Math.max(months, retirement.end);
    // Keep whole years so every reported point is a full year (no short final period).
    months = Math.ceil(months / 12) * 12;
  }
  months = Math.min(720, Math.max(1, months));

  // Contribution weights
  const mixPolicy = o.contributionMix ?? plan.contributionMix;
  const target = o.mixOverride ?? (mixPolicy === 'target' ? p.targetMix : undefined);
  let cw: number[];
  if (target && Object.keys(target).length) cw = classTargetWeights(assets, target, a);
  else {
    const inv = assets.map((s) => (s.investable && !s.synthetic ? s.value0 : 0));
    const tot = inv.reduce((x, y) => x + y, 0);
    cw = tot > 0 ? inv.map((x) => x / tot) : classTargetWeights(assets, BALANCED_FALLBACK, a);
  }
  while (cw.length < assets.length) cw.push(0);

  // Rebalance weights
  const rebal = o.rebalance ?? plan.rebalance;
  let rw = new Array(assets.length).fill(0);
  let rebalance: SimPlan['rebalance'] = 'none';
  if (rebal === 'annual_current') {
    rebalance = 'annual';
    rw = normalize(assets.map((s) => (s.investable ? s.value0 : 0)));
  } else if (rebal === 'annual_target') {
    rebalance = 'annual';
    const tgt = o.mixOverride ?? p.targetMix ?? BALANCED_FALLBACK;
    rw = classTargetWeights(assets, tgt, a);
    while (cw.length < assets.length) cw.push(0);
  }
  while (rw.length < assets.length) rw.push(0);
  if (rebalance === 'annual' && rw.every((x) => x === 0)) rebalance = 'none';

  // Liabilities amortisation (PKR, deterministic)
  const liabilities = new Array(months + 1).fill(0);
  for (const l of p.liabilities) {
    const fx = m.fx[l.currency] ?? 1;
    let bal = (l.balance || 0) * fx;
    const pay = (l.payment || 0) * fx;
    const rm = (l.rate || 0) / 100 / 12;
    for (let k = 0; k <= months; k++) {
      liabilities[k] += Math.max(0, bal);
      if (bal > 0 && pay > 0) bal = bal * (1 + rm) - pay;
      if (bal < 0) bal = 0;
    }
  }

  const noFlows = !!o.noFlows;
  const lumps = noFlows ? [] : plan.lumpSums.map((l) => ({ month: monthsBetween(today, l.date), amount: l.amount })).filter((l) => l.month >= 0);
  const withdrawals = noFlows
    ? []
    : plan.withdrawals.map((w) => ({
        start: Math.max(0, monthsBetween(today, w.start)),
        end: w.end ? monthsBetween(today, w.end) : 10_000,
        monthly: w.monthly,
        indexed: w.indexed,
      }));
  if (!noFlows && o.extraWithdrawalMonthly) withdrawals.push({ start: 0, end: 10_000, monthly: o.extraWithdrawalMonthly, indexed: true });

  const keepSet = new Set<number>();
  goals.forEach((g) => keepSet.add(g.month));
  keepSet.add(Math.round(horizonYears * 12) <= months ? Math.round(horizonYears * 12) : months);
  if (retirement) keepSet.add(retirement.start);
  const keepMonths = Array.from(keepSet).filter((x) => x > 0 && x <= months).sort((x, y) => x - y);
  const goalKeep: Record<string, number> = {};
  goals.forEach((g) => (goalKeep[g.id] = keepMonths.indexOf(g.month)));
  const horizonKeep = keepMonths.indexOf(Math.min(months, Math.round(horizonYears * 12)));

  const { L, repaired } = safeCholesky(a.corr);
  const simPlan: SimPlan = {
    sip: noFlows ? 0 : o.sipMonthly ?? plan.sipMonthly,
    stepUp: noFlows ? 0 : o.sipStepUp ?? plan.sipStepUp,
    lumps,
    withdrawals,
    goals: noFlows ? [] : goals,
    retirement: noFlows ? undefined : retirement,
    contribWeights: cw,
    rebalance,
    rebalanceWeights: rw,
    reinvestIncome: plan.reinvestIncome,
    applyTax: plan.applyTax,
    applyZakat: plan.applyZakat,
    nisab0: nisabPKR(m, ws.settings.nisabBasis),
    liabilities,
  };
  const startNet = assets.reduce((s, x) => s + x.value0, 0) - liabilities[0];
  const input: SimInput = {
    months,
    paths: o.paths ?? plan.paths,
    seed: o.seed ?? plan.seed,
    fCagr: ASSET_FACTORS.map((k) => a.factors[k].cagr),
    fVol: ASSET_FACTORS.map((k) => a.factors[k].vol),
    chol: L,
    macro: {
      ...a.macro,
      incomeSpread: a.spreads.income,
      incomeDuration: a.spreads.incomeDuration,
      mmfSpread: a.spreads.mmf,
    },
    assets,
    plan: simPlan,
    fx0: m.fx.USD,
    keepMonths,
    perClass: o.perClass ?? true,
    trackIncome: o.trackIncome ?? true,
    samplePaths: o.samplePaths ?? 0,
  };
  return { input, months, goalKeep, horizonKeep, cholRepaired: repaired, startNet };
}
