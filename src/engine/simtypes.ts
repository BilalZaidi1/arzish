// Serializable simulation input/output (crosses the worker boundary).

export type SimKind = 'factor' | 'rate' | 'fixed' | 'mix' | 'zero';

export interface SimAsset {
  id: string;
  name: string;
  /** Index into CLASS_ORDER. */
  cls: number;
  /** Optimizer class index (OPT_CLASSES) or -1. */
  opt: number;
  value0: number;
  cost0: number;
  kind: SimKind;
  // factor kind
  mu: number;
  /** Loadings on [psx, gleq, glbond, gold, re, crypto] monthly shocks. */
  load: number[];
  /** Monthly idiosyncratic sd. */
  idio: number;
  /** Exposure to the USD/PKR monthly log change (1 for foreign currency assets). */
  fx: number;
  /** Extra monthly currency noise sd (GBP/EUR versus USD). */
  cross: number;
  /** Loading on the PSX co-move during a devaluation jump. */
  jumpPsx: number;
  // rate / fixed kind
  spread: number;
  duration: number;
  ter: number;
  coupon: number;
  maturityMonth: number;
  reinvestSpread: number;
  // mix kind
  mix: [number, number, number, number, number];
  // income
  /** Cash income paid per year as a fraction of value (factor/mix kinds). */
  yieldAnnual: number;
  /** Rate/fixed kinds: whether the profit is paid out as income. */
  paysIncome: boolean;
  incomeTax: number;
  /** Property: net monthly rent at t0 (PKR, before rent tax), indexed to CPI. */
  rent0: number;
  rentTaxRate: number;
  // flags
  liquid: boolean;
  investable: boolean;
  zakatable: number;
  cgtRate: number;
  synthetic?: boolean;
}

export interface SimGoal {
  id: string;
  month: number;
  amountToday: number;
  inflation: number;
  withdraw: boolean;
}

export interface SimPlan {
  sip: number;
  stepUp: number;
  lumps: { month: number; amount: number }[];
  withdrawals: { start: number; end: number; monthly: number; indexed: boolean }[];
  goals: SimGoal[];
  /** Retirement drawdown, already netted for pension, today's PKR per month. */
  retirement?: { start: number; end: number; monthly: number };
  contribWeights: number[];
  rebalance: 'none' | 'annual';
  rebalanceWeights: number[];
  reinvestIncome: boolean;
  applyTax: boolean;
  applyZakat: boolean;
  nisab0: number;
  /** Liability balances by month (PKR), length months+1. */
  liabilities: number[];
}

export interface SimMacro {
  rate0: number;
  rateLR: number;
  rateVol: number;
  rateKappa: number;
  cpi0: number;
  cpiLR: number;
  cpiVol: number;
  cpiKappa: number;
  fxDrift: number;
  fxVol: number;
  jumpProb: number;
  jumpSize: number;
  jumpPsx: number;
  jumpRate: number;
  jumpCpi: number;
  usInflation: number;
  usdRate: number;
  incomeSpread: number;
  incomeDuration: number;
  mmfSpread: number;
}

export interface SimInput {
  months: number;
  paths: number;
  seed: number;
  /** Factor medians (CAGR %) and vols (%) for [psx, gleq, glbond, gold, re, crypto]. */
  fCagr: number[];
  fVol: number[];
  chol: number[][];
  macro: SimMacro;
  assets: SimAsset[];
  plan: SimPlan;
  fx0: number;
  /** Months at which to keep per-path values for the solver (goal months, horizon). */
  keepMonths: number[];
  /** Keep per-class snapshots (heavier). */
  perClass: boolean;
  /** Compute and return yearly percentiles of income. */
  trackIncome: boolean;
  /** Return a few sample paths (nominal, yearly). */
  samplePaths: number;
  /** Keep every asset's final value per path (risk analytics). */
  recordAssetEnd?: boolean;
}

export const PCTS = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];

export interface SimResult {
  months: number;
  paths: number;
  /** Yearly points: 0..years (the last point is the horizon month). */
  points: number[];
  /** [pctIndex][point] — net worth (assets − liabilities), PKR nominal. */
  nominal: number[][];
  real: number[][];
  usd: number[][];
  usdReal: number[][];
  /** Mean composition of the central paths by class, [class][point], PKR nominal. */
  classCentral: number[][];
  contribCum: number[];
  withdrawCum: number[];
  incomePct: number[][];
  taxMedian: number[];
  zakatMedian: number[];
  cpiPct: number[][];
  fxPct: number[][];
  ratePct: number[][];
  terminalNominal: Float64Array;
  terminalReal: Float64Array;
  terminalLiquid: Float64Array;
  unitTerminal: Float64Array;
  /** Values kept at keepMonths: [k][path] (liquid investable value, before goal withdrawals). */
  keepValues: Float64Array[];
  keepUnits: Float64Array[];
  keepCpi: Float64Array[];
  goals: { id: string; prob: number; medianFundedPct: number; targetNominal: number }[];
  twrCagrPct: number[];
  realTwrPositive: number;
  probLoss1y: number;
  maxDD: { median: number; p90: number };
  survival?: { prob: number; depletionMedianMonth: number | null };
  shortfallProb: number;
  medianGrowth: number;
  samples: number[][];
  cholRepaired: boolean;
  /** [path * nAssets + asset] final values when recordAssetEnd is set. */
  assetEnd?: Float64Array;
  elapsedMs: number;
}
