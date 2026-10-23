// Core data types shared by the engine, the UI and the AI tools.

export type Currency = 'PKR' | 'USD' | 'AED' | 'SAR' | 'GBP' | 'EUR';
export const CURRENCIES: Currency[] = ['PKR', 'USD', 'AED', 'SAR', 'GBP', 'EUR'];

/** Top-level asset classes. Order = categorical color slot order (fixed). */
export type AssetClass = 'psx' | 'funds' | 'fixed' | 'gold' | 'realestate' | 'global' | 'crypto' | 'other';
export const CLASS_ORDER: AssetClass[] = ['psx', 'funds', 'fixed', 'gold', 'realestate', 'global', 'crypto', 'other'];

export type AssetType =
  | 'psx_stock'
  | 'psx_etf'
  | 'mutual_fund'
  | 'vps'
  | 'nss'
  | 'govt_sec'
  | 'deposit'
  | 'cash'
  | 'fx_cash'
  | 'gold'
  | 'silver'
  | 'property'
  | 'global_stock'
  | 'global_etf'
  | 'global_bond'
  | 'crypto'
  | 'retirement'
  | 'business'
  | 'custom';

export type Shariah = 'yes' | 'no' | 'unknown';
export type Liquidity = 'instant' | 'days' | 'weeks' | 'months' | 'locked';
export type Payout = 'none' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'maturity';

export interface Holding {
  id: string;
  type: AssetType;
  name: string;
  ticker?: string;
  /** Sub-type: fund category, NSS product, deposit kind, security kind, property kind, crypto kind… */
  sub?: string;
  account?: string;
  currency: Currency;
  qty: number;
  /** Unit label for display: shares, units, tola, gram, oz, coins, … */
  unit?: string;
  /** Current price per unit in `currency`. For gold/silver: price per tola of 24k. */
  price: number;
  /** Average cost per unit in `currency`. */
  avgCost?: number;
  purchaseDate?: string;
  /** Date the price was last updated (ISO). */
  priceDate?: string;
  sector?: string;
  shariah?: Shariah;
  beta?: number;
  /** Annual income yield in % (dividend yield, distribution yield). */
  yieldPct?: number;
  /** Total expense ratio % (funds). */
  ter?: number;
  /** Fixed profit/coupon rate % (NSS, deposits, securities, FX deposits). */
  rate?: number;
  maturity?: string;
  payout?: Payout;
  /** Gold purity in karat (24, 22, 21, 18). */
  karat?: number;
  /** Use the market snapshot price instead of the stored price (gold, silver). */
  useMarketPrice?: boolean;
  // Property
  city?: string;
  area?: number;
  areaUnit?: 'marla' | 'kanal' | 'sqft' | 'sqyd';
  rentMonthly?: number;
  costsAnnual?: number;
  vacancyPct?: number;
  fbrValue?: number;
  propertyUse?: 'self' | 'rented' | 'investment';
  /** Overrides */
  expReturn?: number;
  vol?: number;
  liquidity?: Liquidity;
  notes?: string;
  /** MUFAP FundID this fund holding follows; its NAV then updates from the daily data. */
  feedId?: string;
  /** Set when the stored price is PSX's daily price (PSX shares and ETFs); cleared when the price is typed in. */
  priceSrc?: 'psx';
  /** PSX shares and ETFs: false keeps the typed price instead of following PSX's daily price. */
  autoPrice?: boolean;
}

export interface Liability {
  id: string;
  type: 'mortgage' | 'car' | 'personal' | 'card' | 'other';
  name: string;
  currency: Currency;
  balance: number;
  rate: number;
  payment: number;
  endDate?: string;
}

export type GoalKind = 'retirement' | 'education' | 'home' | 'hajj' | 'wedding' | 'emergency' | 'car' | 'custom';

export interface Goal {
  id: string;
  name: string;
  kind: GoalKind;
  /** Target in today's money, PKR. */
  target: number;
  date: string;
  /** Yearly cost inflation for this goal, %. */
  inflation: number;
  priority: 'high' | 'medium' | 'low';
  /** Withdraw the goal amount from the portfolio on its date. */
  withdraw: boolean;
}

export interface LumpSum {
  id: string;
  date: string;
  amount: number;
  label?: string;
}

export interface Withdrawal {
  id: string;
  start: string;
  end?: string;
  monthly: number;
  indexed: boolean;
  label?: string;
}

export type RebalancePolicy = 'none' | 'annual_current' | 'annual_target';
export type ContributionMix = 'current' | 'target';

export interface RetirementPlan {
  enabled: boolean;
  age: number;
  retireAge: number;
  lifeAge: number;
  /** Monthly spending need in today's PKR. */
  monthlyNeed: number;
  /** Monthly pension or other income in today's PKR. */
  pension: number;
}

export interface PlanSettings {
  horizonYears: number;
  sipMonthly: number;
  sipStepUp: number;
  lumpSums: LumpSum[];
  withdrawals: Withdrawal[];
  contributionMix: ContributionMix;
  rebalance: RebalancePolicy;
  reinvestIncome: boolean;
  applyTax: boolean;
  applyZakat: boolean;
  paths: number;
  seed: number;
  retirement: RetirementPlan;
}

/** Optimizer classes (property handled separately as locked). */
export type OptClass = 'pkfi' | 'psx' | 'gleq' | 'gold' | 'usd' | 'crypto';
export const OPT_CLASSES: OptClass[] = ['pkfi', 'psx', 'gleq', 'gold', 'usd', 'crypto'];

export type ShockKey = 'psx' | 'gleq' | 'glbond' | 'gold' | 're' | 'crypto' | 'fx' | 'rate' | 'cpi';
export type Shocks = Partial<Record<ShockKey, number>>;

export interface SavedScenario {
  id: string;
  name: string;
  shocks: Shocks;
  source: 'custom' | 'ai';
  note?: string;
}

export interface ChartSpec {
  type: 'line' | 'bar' | 'stacked_bar' | 'area' | 'scatter' | 'heatmap' | 'fan' | 'hbar';
  title: string;
  subtitle?: string;
  x?: { label?: string; categories?: (string | number)[] };
  y?: { label?: string; unit?: 'PKR' | 'USD' | '%' | 'number' };
  series: { name: string; data: (number | null | [number, number])[] }[];
  /** heatmap only */
  heat?: { rows: string[]; cols: string[]; values: number[][] };
  note?: string;
}

export interface PinnedChart {
  id: string;
  title: string;
  spec: ChartSpec;
  prompt?: string;
  createdAt: string;
}

export interface Portfolio {
  id: string;
  name: string;
  isExample?: boolean;
  exampleKey?: string;
  holdings: Holding[];
  liabilities: Liability[];
  goals: Goal[];
  plan: PlanSettings;
  scenarios: SavedScenario[];
  pinned: PinnedChart[];
  targetMix?: Partial<Record<OptClass, number>>;
  lastReview?: { text: string; at: string; model?: string };
  createdAt: string;
  updatedAt: string;
}

export type RiskProfile = 'conservative' | 'moderate' | 'balanced' | 'growth' | 'aggressive';

export interface Settings {
  baseCurrency: 'PKR' | 'USD';
  numberStyle: 'lakh' | 'intl';
  realTerms: boolean;
  theme: 'system' | 'light' | 'dark';
  filer: boolean;
  nisabBasis: 'silver' | 'gold';
  name?: string;
  age?: number;
  riskProfile?: RiskProfile;
  monthlyExpenses: number;
  aiDepth: 'standard' | 'deep';
  foreignCgtRate: number;
  /** Apply the daily market data and fund NAVs automatically (default on). */
  autoData?: boolean;
}

export type FactorKey = 'psx' | 'gleq' | 'glbond' | 'gold' | 're' | 'crypto';
export const ASSET_FACTORS: FactorKey[] = ['psx', 'gleq', 'glbond', 'gold', 're', 'crypto'];
/** Full shock order used by the correlation matrix. */
export const FACTOR_ORDER: ShockKey[] = ['psx', 'gleq', 'glbond', 'gold', 're', 'crypto', 'fx', 'rate', 'cpi'];

export interface MacroAssumptions {
  rate0: number;
  rateLR: number;
  rateVol: number;
  rateKappa: number;
  cpi0: number;
  cpiLR: number;
  cpiVol: number;
  cpiKappa: number;
  /** Diffusive USD/PKR drift, % per year (log-approx). */
  fxDrift: number;
  fxVol: number;
  /** Yearly probability of a devaluation episode. */
  jumpProb: number;
  /** Size of a devaluation jump, % rise in USD/PKR. */
  jumpSize: number;
  /** Co-moves on a jump month. */
  jumpPsx: number;
  jumpRate: number;
  jumpCpi: number;
  usInflation: number;
  usdRate: number;
}

export interface Spreads {
  savings: number;
  tdr: number;
  mmf: number;
  income: number;
  incomeDuration: number;
  nssReinvest: number;
  retirement: number;
}

export interface Assumptions {
  factors: Record<FactorKey, { cagr: number; vol: number }>;
  corr: number[][];
  macro: MacroAssumptions;
  spreads: Spreads;
  asOf: string;
}

export interface MarketSnapshot {
  asOf: string;
  fx: Record<Currency, number>;
  fxDate: string;
  goldTola: number;
  silverTola: number;
  goldUsdOz: number;
  goldDate: string;
  kse100: number;
  kse100Date: string;
  kse100Ytd: number;
  kse100Ath: number;
  policyRate: number;
  policyDate: string;
  cpi: number;
  cpiMonth: string;
  coreCpi: number;
  tbill: { m1: number; m3: number; m6: number; m12: number; date: string };
  nss: Record<string, number>;
  nssDate: string;
  npcUsd: number;
  btcUsd: number;
  btcDate: string;
  sp500: number;
  sp500Date: string;
  sp500Ytd: number;
  fedFunds: number;
  ust10y: number;
  // ---- Filled by the daily data feed (optional; absent in the built-in snapshot)
  /** USD price per coin. */
  crypto?: Record<string, number>;
  cryptoDate?: string;
  /** KIBOR offer rates, %. */
  kibor?: { m3?: number; m6?: number; m12?: number; date?: string };
  /** Open-market (exchange company) buying and selling rates, PKR per unit. */
  fxOpen?: Partial<Record<Currency, { buy: number; sell: number }>>;
  fxOpenDate?: string;
  /** SBP and total liquid FX reserves, USD million. */
  reserves?: { sbp?: number; total?: number; date?: string };
  ust2y?: number;
  usDate?: string;
  /** PSX index levels (KSE-100, KSE-30, KMI-30, All Share, KMI All Share) from the daily data. */
  psxIndices?: { date?: string; time?: string; intraday?: boolean; rows: Record<string, { v: number; chg?: number; chgPct?: number }> };
  /** When the daily data was last applied. */
  feedAt?: string;
  /** Fields the user typed in; the daily data never overwrites them. */
  locked?: string[];
}

export interface Workspace {
  version: number;
  settings: Settings;
  portfolios: Portfolio[];
  activeId: string;
  market: MarketSnapshot;
  assumptions: Assumptions;
  updatedAt: string;
}

export interface Filters {
  classes: AssetClass[];
  currency: 'all' | 'pkr' | 'foreign';
  shariah: 'all' | 'yes';
  liquidity: 'all' | 'liquid' | 'illiquid';
  account: string;
}

export const DEFAULT_FILTERS: Filters = { classes: [], currency: 'all', shariah: 'all', liquidity: 'all', account: 'all' };
