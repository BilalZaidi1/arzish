// Asset-type metadata, sub-type catalogs (MUFAP categories, NSS products, …) and ticker lists.

import type { AssetClass, AssetType, Currency, Liquidity, Payout, Shariah } from './types';

export interface ClassMeta {
  label: string;
  short: string;
  /** Categorical color slot (1–8), 0 = neutral grey. */
  slot: number;
  blurb: string;
}

export const CLASS_META: Record<AssetClass, ClassMeta> = {
  psx: { label: 'PSX stocks', short: 'PSX', slot: 1, blurb: 'Shares and ETFs listed on the Pakistan Stock Exchange' },
  funds: { label: 'Mutual funds', short: 'Funds', slot: 2, blurb: 'Open-end funds and VPS pension sub-funds' },
  fixed: { label: 'Cash & fixed income', short: 'Fixed income', slot: 3, blurb: 'NSS, T-bills, PIBs, deposits and foreign-currency cash' },
  gold: { label: 'Gold & silver', short: 'Gold', slot: 4, blurb: 'Physical gold and silver' },
  realestate: { label: 'Real estate', short: 'Property', slot: 5, blurb: 'Plots, homes, apartments and commercial property' },
  global: { label: 'Global markets', short: 'Global', slot: 6, blurb: 'Foreign stocks, ETFs and bonds' },
  crypto: { label: 'Crypto', short: 'Crypto', slot: 7, blurb: 'Bitcoin, Ether and other digital assets' },
  other: { label: 'Other', short: 'Other', slot: 0, blurb: 'Provident fund, business stakes and custom assets' },
};

export interface TypeMeta {
  type: AssetType;
  label: string;
  cls: AssetClass;
  unit: string;
  currency: Currency;
  liquidity: Liquidity;
  shariah: Shariah;
  hint: string;
}

export const TYPE_META: Record<AssetType, TypeMeta> = {
  psx_stock: { type: 'psx_stock', label: 'PSX stock', cls: 'psx', unit: 'shares', currency: 'PKR', liquidity: 'days', shariah: 'unknown', hint: 'Shares of a company listed on PSX' },
  psx_etf: { type: 'psx_etf', label: 'PSX ETF', cls: 'psx', unit: 'units', currency: 'PKR', liquidity: 'days', shariah: 'unknown', hint: 'Exchange-traded fund listed on PSX' },
  mutual_fund: { type: 'mutual_fund', label: 'Mutual fund', cls: 'funds', unit: 'units', currency: 'PKR', liquidity: 'days', shariah: 'no', hint: 'Open-end fund by MUFAP category' },
  vps: { type: 'vps', label: 'VPS pension', cls: 'funds', unit: 'units', currency: 'PKR', liquidity: 'locked', shariah: 'no', hint: 'Voluntary Pension Scheme allocation' },
  nss: { type: 'nss', label: 'National Savings', cls: 'fixed', unit: 'PKR', currency: 'PKR', liquidity: 'weeks', shariah: 'no', hint: 'Behbood, RIC, DSC, SSC, Sarwa Islamic…' },
  govt_sec: { type: 'govt_sec', label: 'T-bill, PIB or sukuk', cls: 'fixed', unit: 'PKR', currency: 'PKR', liquidity: 'days', shariah: 'no', hint: 'Government securities, including via InvestPak' },
  deposit: { type: 'deposit', label: 'Bank deposit', cls: 'fixed', unit: 'PKR', currency: 'PKR', liquidity: 'instant', shariah: 'no', hint: 'Savings account, term deposit or current account' },
  cash: { type: 'cash', label: 'Cash in hand', cls: 'fixed', unit: 'PKR', currency: 'PKR', liquidity: 'instant', shariah: 'yes', hint: 'Physical cash or wallet balance' },
  fx_cash: { type: 'fx_cash', label: 'Foreign currency', cls: 'fixed', unit: 'amount', currency: 'USD', liquidity: 'instant', shariah: 'no', hint: 'USD, AED, SAR, GBP or EUR deposits, RDA, Naya Pakistan Certificates' },
  gold: { type: 'gold', label: 'Gold', cls: 'gold', unit: 'tola', currency: 'PKR', liquidity: 'days', shariah: 'yes', hint: 'Bars, coins or jewellery by weight and karat' },
  silver: { type: 'silver', label: 'Silver', cls: 'gold', unit: 'tola', currency: 'PKR', liquidity: 'days', shariah: 'yes', hint: 'Silver by weight' },
  property: { type: 'property', label: 'Property', cls: 'realestate', unit: 'property', currency: 'PKR', liquidity: 'months', shariah: 'yes', hint: 'Plot, house, apartment, commercial or agricultural land' },
  global_stock: { type: 'global_stock', label: 'Global stock', cls: 'global', unit: 'shares', currency: 'USD', liquidity: 'days', shariah: 'unknown', hint: 'Shares listed abroad (US, UK, Gulf…)' },
  global_etf: { type: 'global_etf', label: 'Global ETF', cls: 'global', unit: 'units', currency: 'USD', liquidity: 'days', shariah: 'unknown', hint: 'Foreign ETFs such as VOO, VT or UCITS funds' },
  global_bond: { type: 'global_bond', label: 'Global bond', cls: 'global', unit: 'units', currency: 'USD', liquidity: 'days', shariah: 'no', hint: 'US Treasuries, bond ETFs, Eurobonds' },
  crypto: { type: 'crypto', label: 'Crypto', cls: 'crypto', unit: 'coins', currency: 'USD', liquidity: 'days', shariah: 'unknown', hint: 'Bitcoin, Ether, stablecoins…' },
  retirement: { type: 'retirement', label: 'Provident fund or pension', cls: 'other', unit: 'PKR', currency: 'PKR', liquidity: 'locked', shariah: 'unknown', hint: 'Employer provident fund, gratuity or pension balance' },
  business: { type: 'business', label: 'Business stake', cls: 'other', unit: 'PKR', currency: 'PKR', liquidity: 'locked', shariah: 'unknown', hint: 'Private business or startup equity' },
  custom: { type: 'custom', label: 'Custom asset', cls: 'other', unit: 'PKR', currency: 'PKR', liquidity: 'months', shariah: 'unknown', hint: 'Anything else, with your own return and risk' },
};

export const TYPE_ORDER: AssetType[] = [
  'psx_stock', 'psx_etf', 'mutual_fund', 'vps', 'nss', 'govt_sec', 'deposit', 'cash', 'fx_cash',
  'gold', 'silver', 'property', 'global_stock', 'global_etf', 'global_bond', 'crypto', 'retirement', 'business', 'custom',
];

/** Fund look-through mix: shares of equity, PKR income, cash, gold, global. */
export interface FundMix {
  eq: number;
  income: number;
  cash: number;
  gold: number;
  global: number;
}

export interface FundCategory {
  key: string;
  label: string;
  mix: FundMix;
  ter: number;
  shariah: Shariah;
  /** Income spread over the short rate for the income sleeve (pts). */
  incomeSpread?: number;
  fixed?: boolean;
}

const M = (eq: number, income: number, cash: number, gold = 0, global = 0): FundMix => ({ eq, income, cash, gold, global });

export const FUND_CATEGORIES: FundCategory[] = [
  { key: 'equity', label: 'Equity', mix: M(0.92, 0, 0.08), ter: 3.5, shariah: 'no' },
  { key: 'islamic_equity', label: 'Islamic equity', mix: M(0.92, 0, 0.08), ter: 3.5, shariah: 'yes' },
  { key: 'index', label: 'Index tracker', mix: M(0.98, 0, 0.02), ter: 1.5, shariah: 'no' },
  { key: 'balanced', label: 'Balanced / asset allocation', mix: M(0.5, 0.4, 0.1), ter: 3.0, shariah: 'no' },
  { key: 'islamic_aa', label: 'Islamic asset allocation', mix: M(0.5, 0.4, 0.1), ter: 3.0, shariah: 'yes' },
  { key: 'income', label: 'Income', mix: M(0, 0.9, 0.1), ter: 1.5, shariah: 'no' },
  { key: 'islamic_income', label: 'Islamic income', mix: M(0, 0.9, 0.1), ter: 1.3, shariah: 'yes' },
  { key: 'aggressive_income', label: 'Aggressive fixed income', mix: M(0, 1, 0), ter: 1.8, shariah: 'no', incomeSpread: 1.0 },
  { key: 'money_market', label: 'Money market', mix: M(0, 0, 1), ter: 1.0, shariah: 'no' },
  { key: 'islamic_mm', label: 'Islamic money market', mix: M(0, 0, 1), ter: 0.9, shariah: 'yes' },
  { key: 'fixed_return', label: 'Fixed rate / return', mix: M(0, 0, 1), ter: 0.8, shariah: 'unknown', fixed: true },
  { key: 'capital_protected', label: 'Capital protected', mix: M(0.2, 0, 0.8), ter: 1.5, shariah: 'no' },
  { key: 'fund_of_funds', label: 'Fund of funds', mix: M(0.4, 0.4, 0.2), ter: 2.0, shariah: 'no' },
  { key: 'gold_fund', label: 'Commodity (gold)', mix: M(0, 0, 0.05, 0.95), ter: 2.0, shariah: 'yes' },
  { key: 'global_fund', label: 'International / feeder', mix: M(0, 0, 0.05, 0, 0.95), ter: 2.5, shariah: 'unknown' },
];

export const VPS_SCHEMES: FundCategory[] = [
  { key: 'vps_high', label: 'High volatility (80% equity)', mix: M(0.8, 0.2, 0), ter: 1.8, shariah: 'no' },
  { key: 'vps_medium', label: 'Medium volatility (50% equity)', mix: M(0.5, 0.4, 0.1), ter: 1.6, shariah: 'no' },
  { key: 'vps_low', label: 'Low volatility (20% equity)', mix: M(0.2, 0.6, 0.2), ter: 1.4, shariah: 'no' },
  { key: 'vps_lower', label: 'Lower volatility (no equity)', mix: M(0, 0.5, 0.5), ter: 1.2, shariah: 'no' },
  { key: 'vps_equity', label: 'Equity sub-fund', mix: M(0.95, 0, 0.05), ter: 2.0, shariah: 'no' },
  { key: 'vps_debt', label: 'Debt sub-fund', mix: M(0, 0.95, 0.05), ter: 1.3, shariah: 'no' },
  { key: 'vps_mm', label: 'Money market sub-fund', mix: M(0, 0, 1), ter: 1.0, shariah: 'no' },
];

export function fundCategory(type: AssetType, sub?: string): FundCategory {
  const list = type === 'vps' ? VPS_SCHEMES : FUND_CATEGORIES;
  return list.find((c) => c.key === sub) ?? list[0];
}

export interface NssProduct {
  key: string;
  label: string;
  payout: Payout;
  years: number;
  shariah: Shariah;
  note: string;
}

export const NSS_PRODUCTS: NssProduct[] = [
  { key: 'BSC', label: 'Behbood Savings Certificates', payout: 'monthly', years: 10, shariah: 'no', note: 'Senior citizens, widows and persons with disabilities' },
  { key: 'PBA', label: "Pensioners' Benefit Account", payout: 'monthly', years: 10, shariah: 'no', note: 'Retired government and other pensioners' },
  { key: 'SHUHADA', label: 'Shuhada Family Welfare Account', payout: 'monthly', years: 10, shariah: 'no', note: 'Families of shuhada' },
  { key: 'RIC', label: 'Regular Income Certificates', payout: 'monthly', years: 5, shariah: 'no', note: 'Monthly profit' },
  { key: 'SSC', label: 'Special Savings Certificates', payout: 'semiannual', years: 3, shariah: 'no', note: 'Profit every six months' },
  { key: 'DSC', label: 'Defence Savings Certificates', payout: 'maturity', years: 10, shariah: 'no', note: 'Profit accumulates, paid at maturity' },
  { key: 'STSC', label: 'Short Term Savings Certificates', payout: 'maturity', years: 1, shariah: 'no', note: '3, 6 or 12 months' },
  { key: 'SITA3', label: 'Sarwa Islamic Term Account, 3 years', payout: 'monthly', years: 3, shariah: 'yes', note: 'Shariah-compliant' },
  { key: 'SITA5', label: 'Sarwa Islamic Term Account, 5 years', payout: 'monthly', years: 5, shariah: 'yes', note: 'Shariah-compliant' },
  { key: 'SISA', label: 'Sarwa Islamic Savings Account', payout: 'monthly', years: 0, shariah: 'yes', note: 'Shariah-compliant, no fixed term' },
  { key: 'PRIZE', label: 'Prize bonds', payout: 'none', years: 0, shariah: 'unknown', note: 'Return depends on draws' },
];

export function nssProduct(key?: string): NssProduct {
  return NSS_PRODUCTS.find((p) => p.key === key) ?? NSS_PRODUCTS[3];
}

export interface SimpleOption {
  key: string;
  label: string;
}

export const DEPOSIT_KINDS: (SimpleOption & { rate: number; payout: Payout; shariah: Shariah })[] = [
  { key: 'savings', label: 'Savings account', rate: 10.0, payout: 'monthly', shariah: 'no' },
  { key: 'islamic_savings', label: 'Islamic savings account', rate: 9.5, payout: 'monthly', shariah: 'yes' },
  { key: 'tdr', label: 'Term deposit', rate: 11.0, payout: 'monthly', shariah: 'no' },
  { key: 'islamic_tdr', label: 'Islamic term deposit', rate: 10.5, payout: 'monthly', shariah: 'yes' },
  { key: 'current', label: 'Current account', rate: 0, payout: 'none', shariah: 'yes' },
];

export const GOVT_KINDS: (SimpleOption & { rate: number; payout: Payout; duration: number; shariah: Shariah })[] = [
  { key: 'tbill', label: 'Treasury bill', rate: 12.0, payout: 'maturity', duration: 0.3, shariah: 'no' },
  { key: 'pib_fixed', label: 'PIB, fixed rate', rate: 12.0, payout: 'semiannual', duration: 3.5, shariah: 'no' },
  { key: 'pib_floating', label: 'PIB, floating rate', rate: 12.0, payout: 'semiannual', duration: 0.5, shariah: 'no' },
  { key: 'gis', label: 'GOP Ijara sukuk', rate: 11.8, payout: 'semiannual', duration: 0.5, shariah: 'yes' },
  { key: 'tfc', label: 'Corporate TFC / sukuk', rate: 13.0, payout: 'quarterly', duration: 1.5, shariah: 'unknown' },
];

export const FX_KINDS: (SimpleOption & { rate: number; shariah: Shariah })[] = [
  { key: 'fcy_deposit', label: 'Foreign currency deposit', rate: 1.0, shariah: 'no' },
  { key: 'rda', label: 'Roshan Digital Account', rate: 1.0, shariah: 'no' },
  { key: 'npc', label: 'Naya Pakistan Certificate', rate: 7.25, shariah: 'no' },
  { key: 'npc_islamic', label: 'Naya Pakistan Certificate, Islamic', rate: 7.0, shariah: 'yes' },
  { key: 'cash', label: 'Physical cash', rate: 0, shariah: 'yes' },
];

export const PROPERTY_KINDS: SimpleOption[] = [
  { key: 'residential_plot', label: 'Residential plot' },
  { key: 'house', label: 'House' },
  { key: 'apartment', label: 'Apartment' },
  { key: 'commercial_plot', label: 'Commercial plot' },
  { key: 'commercial', label: 'Shop or office' },
  { key: 'agricultural', label: 'Agricultural land' },
  { key: 'file', label: 'Booking file' },
];

export const CRYPTO_KINDS: (SimpleOption & { beta: number; idio: number; stable?: boolean })[] = [
  { key: 'btc', label: 'Bitcoin', beta: 1, idio: 0 },
  { key: 'eth', label: 'Ether', beta: 1.2, idio: 25 },
  { key: 'alt', label: 'Other coin', beta: 1.4, idio: 45 },
  { key: 'stable', label: 'Stablecoin', beta: 0, idio: 0, stable: true },
];

export const RETIREMENT_KINDS: SimpleOption[] = [
  { key: 'provident', label: 'Provident fund' },
  { key: 'gratuity', label: 'Gratuity fund' },
  { key: 'pension', label: 'Pension fund' },
  { key: 'eobi', label: 'EOBI' },
];

export interface SectorMeta {
  beta: number;
  dy: number;
}

export const PSX_SECTORS: Record<string, SectorMeta> = {
  'Commercial banks': { beta: 0.9, dy: 10 },
  'Oil & gas exploration': { beta: 1.1, dy: 6 },
  'Oil & gas marketing': { beta: 1.2, dy: 6 },
  Refinery: { beta: 1.5, dy: 2 },
  Fertilizer: { beta: 0.75, dy: 10 },
  Cement: { beta: 1.3, dy: 3 },
  'Power generation': { beta: 0.85, dy: 11 },
  Technology: { beta: 1.3, dy: 2 },
  Automobiles: { beta: 1.15, dy: 6 },
  Pharmaceuticals: { beta: 0.9, dy: 3 },
  'Food & personal care': { beta: 0.6, dy: 4 },
  Chemicals: { beta: 1.1, dy: 6 },
  Textiles: { beta: 1.0, dy: 4 },
  'Steel & engineering': { beta: 1.35, dy: 4 },
  Insurance: { beta: 0.8, dy: 8 },
  'Holding companies': { beta: 1.1, dy: 6 },
  'Paper & packaging': { beta: 0.9, dy: 4 },
  'Glass & ceramics': { beta: 1.1, dy: 4 },
  'Electrical goods': { beta: 1.3, dy: 2 },
  Transport: { beta: 1.0, dy: 6 },
  Tobacco: { beta: 0.6, dy: 7 },
  Media: { beta: 1.2, dy: 3 },
  'Leather & footwear': { beta: 0.9, dy: 3 },
  ETF: { beta: 1.0, dy: 7 },
  Other: { beta: 1.0, dy: 5 },
};

export interface TickerMeta {
  ticker: string;
  name: string;
  sector: string;
  shariah?: Shariah;
}

/** Common PSX tickers. Shariah status of most stocks changes with KMI recompositions: left unverified. */
export const PSX_TICKERS: TickerMeta[] = [
  { ticker: 'MEBL', name: 'Meezan Bank', sector: 'Commercial banks', shariah: 'yes' },
  { ticker: 'BIPL', name: 'BankIslami Pakistan', sector: 'Commercial banks', shariah: 'yes' },
  { ticker: 'FABL', name: 'Faysal Bank', sector: 'Commercial banks', shariah: 'yes' },
  { ticker: 'MCB', name: 'MCB Bank', sector: 'Commercial banks', shariah: 'no' },
  { ticker: 'UBL', name: 'United Bank', sector: 'Commercial banks', shariah: 'no' },
  { ticker: 'HBL', name: 'Habib Bank', sector: 'Commercial banks', shariah: 'no' },
  { ticker: 'NBP', name: 'National Bank of Pakistan', sector: 'Commercial banks', shariah: 'no' },
  { ticker: 'BAHL', name: 'Bank AL Habib', sector: 'Commercial banks', shariah: 'no' },
  { ticker: 'BAFL', name: 'Bank Alfalah', sector: 'Commercial banks', shariah: 'no' },
  { ticker: 'ABL', name: 'Allied Bank', sector: 'Commercial banks', shariah: 'no' },
  { ticker: 'AKBL', name: 'Askari Bank', sector: 'Commercial banks', shariah: 'no' },
  { ticker: 'BOP', name: 'The Bank of Punjab', sector: 'Commercial banks', shariah: 'no' },
  { ticker: 'HMB', name: 'Habib Metropolitan Bank', sector: 'Commercial banks', shariah: 'no' },
  { ticker: 'OGDC', name: 'Oil & Gas Development Co.', sector: 'Oil & gas exploration' },
  { ticker: 'PPL', name: 'Pakistan Petroleum', sector: 'Oil & gas exploration' },
  { ticker: 'MARI', name: 'Mari Energies', sector: 'Oil & gas exploration' },
  { ticker: 'POL', name: 'Pakistan Oilfields', sector: 'Oil & gas exploration' },
  { ticker: 'PSO', name: 'Pakistan State Oil', sector: 'Oil & gas marketing' },
  { ticker: 'APL', name: 'Attock Petroleum', sector: 'Oil & gas marketing' },
  { ticker: 'SNGP', name: 'Sui Northern Gas Pipelines', sector: 'Oil & gas marketing' },
  { ticker: 'SSGC', name: 'Sui Southern Gas Co.', sector: 'Oil & gas marketing' },
  { ticker: 'ATRL', name: 'Attock Refinery', sector: 'Refinery' },
  { ticker: 'NRL', name: 'National Refinery', sector: 'Refinery' },
  { ticker: 'PRL', name: 'Pakistan Refinery', sector: 'Refinery' },
  { ticker: 'CNERGY', name: 'Cnergyico PK', sector: 'Refinery' },
  { ticker: 'FFC', name: 'Fauji Fertilizer Co.', sector: 'Fertilizer' },
  { ticker: 'EFERT', name: 'Engro Fertilizers', sector: 'Fertilizer' },
  { ticker: 'FATIMA', name: 'Fatima Fertilizer', sector: 'Fertilizer' },
  { ticker: 'ENGROH', name: 'Engro Holdings', sector: 'Holding companies' },
  { ticker: 'DAWH', name: 'Dawood Hercules Corp.', sector: 'Holding companies' },
  { ticker: 'LUCK', name: 'Lucky Cement', sector: 'Cement' },
  { ticker: 'DGKC', name: 'D.G. Khan Cement', sector: 'Cement' },
  { ticker: 'MLCF', name: 'Maple Leaf Cement', sector: 'Cement' },
  { ticker: 'FCCL', name: 'Fauji Cement', sector: 'Cement' },
  { ticker: 'CHCC', name: 'Cherat Cement', sector: 'Cement' },
  { ticker: 'PIOC', name: 'Pioneer Cement', sector: 'Cement' },
  { ticker: 'KOHC', name: 'Kohat Cement', sector: 'Cement' },
  { ticker: 'ACPL', name: 'Attock Cement', sector: 'Cement' },
  { ticker: 'HUBC', name: 'Hub Power Co.', sector: 'Power generation' },
  { ticker: 'KAPCO', name: 'Kot Addu Power', sector: 'Power generation' },
  { ticker: 'NPL', name: 'Nishat Power', sector: 'Power generation' },
  { ticker: 'KEL', name: 'K-Electric', sector: 'Power generation' },
  { ticker: 'SYS', name: 'Systems Ltd', sector: 'Technology' },
  { ticker: 'TRG', name: 'TRG Pakistan', sector: 'Technology' },
  { ticker: 'AVN', name: 'Avanceon', sector: 'Technology' },
  { ticker: 'NETSOL', name: 'NetSol Technologies', sector: 'Technology' },
  { ticker: 'PTC', name: 'Pakistan Telecommunication Co.', sector: 'Technology' },
  { ticker: 'AIRLINK', name: 'Air Link Communication', sector: 'Technology' },
  { ticker: 'INDU', name: 'Indus Motor Co.', sector: 'Automobiles' },
  { ticker: 'HCAR', name: 'Honda Atlas Cars', sector: 'Automobiles' },
  { ticker: 'MTL', name: 'Millat Tractors', sector: 'Automobiles' },
  { ticker: 'SAZEW', name: 'Sazgar Engineering Works', sector: 'Automobiles' },
  { ticker: 'GHNI', name: 'Ghandhara Industries', sector: 'Automobiles' },
  { ticker: 'ATLH', name: 'Atlas Honda', sector: 'Automobiles' },
  { ticker: 'THALL', name: 'Thal Ltd', sector: 'Automobiles' },
  { ticker: 'SEARL', name: 'The Searle Co.', sector: 'Pharmaceuticals' },
  { ticker: 'AGP', name: 'AGP Ltd', sector: 'Pharmaceuticals' },
  { ticker: 'ABOT', name: 'Abbott Laboratories (Pakistan)', sector: 'Pharmaceuticals' },
  { ticker: 'HINOON', name: 'Highnoon Laboratories', sector: 'Pharmaceuticals' },
  { ticker: 'FEROZ', name: 'Ferozsons Laboratories', sector: 'Pharmaceuticals' },
  { ticker: 'CPHL', name: 'Citi Pharma', sector: 'Pharmaceuticals' },
  { ticker: 'NESTLE', name: 'Nestlé Pakistan', sector: 'Food & personal care' },
  { ticker: 'UPFL', name: 'Unilever Pakistan Foods', sector: 'Food & personal care' },
  { ticker: 'NATF', name: 'National Foods', sector: 'Food & personal care' },
  { ticker: 'FFL', name: 'Fauji Foods', sector: 'Food & personal care' },
  { ticker: 'COLG', name: 'Colgate-Palmolive Pakistan', sector: 'Food & personal care' },
  { ticker: 'EPCL', name: 'Engro Polymer & Chemicals', sector: 'Chemicals' },
  { ticker: 'LCI', name: 'Lucky Core Industries', sector: 'Chemicals' },
  { ticker: 'ILP', name: 'Interloop', sector: 'Textiles' },
  { ticker: 'NML', name: 'Nishat Mills', sector: 'Textiles' },
  { ticker: 'GATM', name: 'Gul Ahmed Textile Mills', sector: 'Textiles' },
  { ticker: 'KTML', name: 'Kohinoor Textile Mills', sector: 'Textiles' },
  { ticker: 'ISL', name: 'International Steels', sector: 'Steel & engineering' },
  { ticker: 'INIL', name: 'International Industries', sector: 'Steel & engineering' },
  { ticker: 'ASTL', name: 'Amreli Steels', sector: 'Steel & engineering' },
  { ticker: 'MUGHAL', name: 'Mughal Iron & Steel', sector: 'Steel & engineering' },
  { ticker: 'AICL', name: 'Adamjee Insurance', sector: 'Insurance', shariah: 'no' },
  { ticker: 'JLICL', name: 'Jubilee Life Insurance', sector: 'Insurance', shariah: 'no' },
  { ticker: 'EFUG', name: 'EFU General Insurance', sector: 'Insurance', shariah: 'no' },
  { ticker: 'PKGS', name: 'Packages Ltd', sector: 'Paper & packaging' },
  { ticker: 'CEPB', name: 'Century Paper & Board', sector: 'Paper & packaging' },
  { ticker: 'TGL', name: 'Tariq Glass', sector: 'Glass & ceramics' },
  { ticker: 'GHGL', name: 'Ghani Glass', sector: 'Glass & ceramics' },
  { ticker: 'PAEL', name: 'Pak Elektron', sector: 'Electrical goods' },
  { ticker: 'PIBTL', name: 'Pakistan International Bulk Terminal', sector: 'Transport' },
  { ticker: 'PAKT', name: 'Pakistan Tobacco Co.', sector: 'Tobacco', shariah: 'no' },
  { ticker: 'SRVI', name: 'Service Industries', sector: 'Leather & footwear' },
  { ticker: 'HUMNL', name: 'Hum Network', sector: 'Media' },
];

export const PSX_ETFS: TickerMeta[] = [
  { ticker: 'MZNPETF', name: 'Meezan Pakistan ETF', sector: 'ETF', shariah: 'yes' },
  { ticker: 'MIIETF', name: 'Mahaana Islamic Index ETF', sector: 'ETF', shariah: 'yes' },
  { ticker: 'NBPGETF', name: 'NBP Pakistan Growth ETF', sector: 'ETF' },
  { ticker: 'NITGETF', name: 'NIT Pakistan Gateway ETF', sector: 'ETF' },
  { ticker: 'UBLPETF', name: 'UBL Pakistan Enterprise ETF', sector: 'ETF' },
  { ticker: 'JSMFETF', name: 'JS Momentum Factor ETF', sector: 'ETF' },
];

export interface GlobalTicker extends TickerMeta {
  kind: 'equity' | 'bond' | 'gold' | 'crypto';
  beta: number;
  dy: number;
  idio?: number;
}

export const GLOBAL_TICKERS: GlobalTicker[] = [
  { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', sector: 'US large cap', kind: 'equity', beta: 1.0, dy: 1.2 },
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', sector: 'US large cap', kind: 'equity', beta: 1.0, dy: 1.2 },
  { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', sector: 'US total market', kind: 'equity', beta: 1.02, dy: 1.2 },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', sector: 'US technology', kind: 'equity', beta: 1.15, dy: 0.6 },
  { ticker: 'VT', name: 'Vanguard Total World Stock ETF', sector: 'Global equity', kind: 'equity', beta: 0.95, dy: 1.8 },
  { ticker: 'VXUS', name: 'Vanguard Total International Stock ETF', sector: 'International equity', kind: 'equity', beta: 0.9, dy: 2.9 },
  { ticker: 'VWO', name: 'Vanguard Emerging Markets ETF', sector: 'Emerging markets', kind: 'equity', beta: 1.0, dy: 2.8, idio: 8 },
  { ticker: 'SCHD', name: 'Schwab US Dividend Equity ETF', sector: 'US dividend', kind: 'equity', beta: 0.85, dy: 3.6 },
  { ticker: 'VYM', name: 'Vanguard High Dividend Yield ETF', sector: 'US dividend', kind: 'equity', beta: 0.85, dy: 2.7 },
  { ticker: 'VWRA', name: 'Vanguard FTSE All-World UCITS ETF (Acc)', sector: 'Global equity', kind: 'equity', beta: 0.95, dy: 0 },
  { ticker: 'CSPX', name: 'iShares Core S&P 500 UCITS ETF (Acc)', sector: 'US large cap', kind: 'equity', beta: 1.0, dy: 0 },
  { ticker: 'IWDA', name: 'iShares Core MSCI World UCITS ETF (Acc)', sector: 'Global equity', kind: 'equity', beta: 0.97, dy: 0 },
  { ticker: 'EIMI', name: 'iShares Core MSCI EM IMI UCITS ETF (Acc)', sector: 'Emerging markets', kind: 'equity', beta: 1.0, dy: 0, idio: 8 },
  { ticker: 'AAPL', name: 'Apple', sector: 'Technology', kind: 'equity', beta: 1.15, dy: 0.5, idio: 22 },
  { ticker: 'MSFT', name: 'Microsoft', sector: 'Technology', kind: 'equity', beta: 1.1, dy: 0.7, idio: 20 },
  { ticker: 'NVDA', name: 'NVIDIA', sector: 'Technology', kind: 'equity', beta: 1.6, dy: 0.1, idio: 40 },
  { ticker: 'AMZN', name: 'Amazon', sector: 'Consumer', kind: 'equity', beta: 1.2, dy: 0, idio: 25 },
  { ticker: 'GOOGL', name: 'Alphabet', sector: 'Technology', kind: 'equity', beta: 1.1, dy: 0.4, idio: 22 },
  { ticker: 'META', name: 'Meta Platforms', sector: 'Technology', kind: 'equity', beta: 1.25, dy: 0.3, idio: 28 },
  { ticker: 'TSLA', name: 'Tesla', sector: 'Consumer', kind: 'equity', beta: 1.7, dy: 0, idio: 45 },
  { ticker: 'BRK.B', name: 'Berkshire Hathaway', sector: 'Financials', kind: 'equity', beta: 0.85, dy: 0, idio: 14 },
  { ticker: 'BND', name: 'Vanguard Total Bond Market ETF', sector: 'US bonds', kind: 'bond', beta: 1.0, dy: 4.0 },
  { ticker: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', sector: 'US long Treasuries', kind: 'bond', beta: 2.4, dy: 4.4 },
  { ticker: 'SGOV', name: 'iShares 0-3 Month Treasury Bond ETF', sector: 'US T-bills', kind: 'bond', beta: 0.1, dy: 4.0 },
  { ticker: 'GLD', name: 'SPDR Gold Shares', sector: 'Gold', kind: 'gold', beta: 1.0, dy: 0 },
  { ticker: 'IAU', name: 'iShares Gold Trust', sector: 'Gold', kind: 'gold', beta: 1.0, dy: 0 },
  { ticker: 'IBIT', name: 'iShares Bitcoin Trust', sector: 'Bitcoin', kind: 'crypto', beta: 1.0, dy: 0 },
];

export const CRYPTO_TICKERS: { ticker: string; name: string; kind: string }[] = [
  { ticker: 'BTC', name: 'Bitcoin', kind: 'btc' },
  { ticker: 'ETH', name: 'Ether', kind: 'eth' },
  { ticker: 'SOL', name: 'Solana', kind: 'alt' },
  { ticker: 'BNB', name: 'BNB', kind: 'alt' },
  { ticker: 'XRP', name: 'XRP', kind: 'alt' },
  { ticker: 'USDT', name: 'Tether', kind: 'stable' },
  { ticker: 'USDC', name: 'USD Coin', kind: 'stable' },
];

export const LIQUIDITY_META: Record<Liquidity, { label: string; detail: string; order: number }> = {
  instant: { label: 'Same day', detail: 'Cash, savings, current accounts', order: 0 },
  days: { label: 'Within a week', detail: 'PSX (T+2), funds (1–3 days), gold, global, crypto', order: 1 },
  weeks: { label: 'Within a month', detail: 'NSS encashment, term deposits', order: 2 },
  months: { label: '3–12 months', detail: 'Property sales', order: 3 },
  locked: { label: 'Locked', detail: 'VPS, provident fund, business stakes', order: 4 },
};

export const GOAL_PRESETS: { kind: import('./types').GoalKind; label: string; inflation: number; withdraw: boolean; years: number; target: number }[] = [
  { kind: 'retirement', label: 'Retirement corpus', inflation: 8, withdraw: false, years: 20, target: 50_000_000 },
  { kind: 'education', label: "Child's university", inflation: 11, withdraw: true, years: 12, target: 6_000_000 },
  { kind: 'home', label: 'Buy a home', inflation: 9, withdraw: true, years: 7, target: 25_000_000 },
  { kind: 'hajj', label: 'Hajj or Umrah', inflation: 9, withdraw: true, years: 3, target: 2_500_000 },
  { kind: 'wedding', label: 'Wedding', inflation: 10, withdraw: true, years: 8, target: 4_000_000 },
  { kind: 'emergency', label: 'Emergency fund', inflation: 8, withdraw: false, years: 1, target: 1_500_000 },
  { kind: 'car', label: 'Car', inflation: 10, withdraw: true, years: 3, target: 6_000_000 },
  { kind: 'custom', label: 'Custom goal', inflation: 8, withdraw: true, years: 5, target: 5_000_000 },
];

export const TOLA_GRAMS = 11.6638;
export const OZ_GRAMS = 31.1035;

export function liquidityRank(l: Liquidity): number {
  return LIQUIDITY_META[l].order;
}
