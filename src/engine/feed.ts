// Daily market data: the shared documents the scheduled agent writes (market/latest, the fund NAV
// list market/funds and PSX closing prices market/psx), and the pure functions that apply them.

import type { Currency, Holding, MarketSnapshot, Portfolio, Shariah } from './types';

export interface FeedStatus {
  ok: boolean;
  at?: string;
  error?: string;
  /** The source is switched off on purpose (for example, the site does not allow automated access). */
  disabled?: boolean;
}

export interface FeedDoc {
  v: number;
  updatedAt: string;
  builtAt?: string;
  market: Partial<MarketSnapshot>;
  dates?: Record<string, string>;
  sources?: Record<string, string>;
  sourceInfo?: Record<string, { label: string; url: string }>;
  extra?: {
    kibor?: { m3?: { bid: number; offer: number }; m6?: { bid: number; offer: number }; m12?: { bid: number; offer: number }; asOf?: string };
    openMarket?: { rates?: Record<string, { buy: number; sell: number }>; asOf?: string; url?: string };
    reserves?: { sbp?: number; banks?: number; total?: number; asOf?: string };
    crypto?: { asOf?: string; usd?: Record<string, number> };
    usTreasury?: { asOf?: string; m3?: number; y2?: number; y10?: number };
    metals?: { asOf?: string; goldUsdOz?: number; silverUsdOz?: number; goldTolaSpotPkr?: number; silverTolaSpotPkr?: number };
    psx?: {
      asOf?: string;
      time?: string;
      state?: string;
      intraday?: boolean;
      breadth?: { advance?: number; decline?: number; unchanged?: number };
      indices?: Record<string, { v: number; high?: number; low?: number; chg?: number; chgPct?: number }>;
      count?: number;
    };
    [k: string]: unknown;
  };
  status?: Record<string, FeedStatus>;
  notes?: string[];
}

export interface FundNav {
  /** MUFAP FundID */
  id: string;
  n: string;
  amc: string;
  cat: string;
  sec: string;
  nav: number;
  /** Validity date (YYYY-MM-DD) */
  d: string;
  off?: number;
  red?: number;
  /** 1 when MUFAP lists the fund as Shariah compliant. */
  sh?: number;
  /** Total expense ratio, % a year. */
  ter?: number;
  /** 1-year total return with payouts reinvested, %. */
  r1y?: number;
  /** 1 when the fund has stopped reporting NAVs. */
  stale?: number;
}

export interface FundsDoc {
  v: number;
  asOf: string;
  reportDate?: string;
  count: number;
  builtAt?: string;
  source?: { label: string; url: string };
  funds: FundNav[];
}

/** One PSX share or ETF from the daily price list (market/psx). */
export interface PsxQuote {
  /** Symbol */
  s: string;
  /** Company or fund name */
  n: string;
  /** PSX sector name */
  sec?: string;
  /** Last price, PKR */
  p: number;
  /** Day change, % */
  c?: number;
  /** 1-year change, % */
  y1?: number;
  /** P/E (trailing) */
  pe?: number;
  /** Dividend yield, % */
  dy?: number;
  /** Market value, PKR billion */
  mcB?: number;
  /** 1 when in the KMI All Share index (Shariah screened) */
  sh?: number;
  /** 1 when in the KSE-100 */
  k100?: number;
  /** 1 for ETFs */
  etf?: number;
  /** Suffix PSX shows while the share trades ex-entitlement (XD, XB, XR) or in the defaulters' segment (NC) */
  x?: string;
  /** Price date when it differs from the list's date (ETFs) */
  d?: string;
}

export interface PsxDoc {
  v: number;
  /** Trading day the prices belong to */
  asOf: string;
  /** Time of the prices (PKT), when taken during a session */
  time?: string;
  intraday?: boolean;
  builtAt?: string;
  count: number;
  source?: { label: string; url: string };
  stocks: PsxQuote[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const CURRENCIES: Currency[] = ['USD', 'AED', 'SAR', 'EUR', 'GBP'];

/** Accept only well-formed documents; anything else is treated as absent. */
export function parseFeed(raw: unknown): FeedDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as FeedDoc;
  if (typeof d.updatedAt !== 'string' || !d.market || typeof d.market !== 'object') return null;
  return d;
}

export function parseFunds(raw: unknown): FundsDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as FundsDoc;
  if (!Array.isArray(d.funds)) return null;
  const funds = d.funds.filter((f) => f && typeof f.id === 'string' && typeof f.n === 'string' && isNum(f.nav) && f.nav > 0);
  return { ...d, funds, count: funds.length };
}

export function parsePsx(raw: unknown): PsxDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as PsxDoc;
  if (!Array.isArray(d.stocks) || typeof d.asOf !== 'string') return null;
  const stocks = d.stocks.filter((q) => q && typeof q.s === 'string' && isNum(q.p) && q.p > 0);
  return stocks.length ? { ...d, stocks, count: stocks.length } : null;
}

const inRange = (v: unknown, lo: number, hi: number): v is number => isNum(v) && v >= lo && v <= hi;

/** Apply the daily data to a market snapshot. Fields the user typed in (`locked`) are left alone. */
export function applyFeed(m: MarketSnapshot, f: FeedDoc): MarketSnapshot {
  const lock = new Set(m.locked ?? []);
  const src = f.market;
  const out: MarketSnapshot = { ...m, fx: { ...m.fx }, nss: { ...m.nss }, tbill: { ...m.tbill } };
  const scalar = (key: keyof MarketSnapshot, lo: number, hi: number, dateKey?: keyof MarketSnapshot) => {
    const v = src[key];
    if (lock.has(key) || !inRange(v, lo, hi)) return false;
    (out as unknown as Record<string, unknown>)[key] = v;
    if (dateKey && typeof src[dateKey] === 'string') (out as unknown as Record<string, unknown>)[dateKey] = src[dateKey];
    return true;
  };
  if (src.fx && !lock.has('fx')) {
    let any = false;
    for (const c of CURRENCIES) {
      const v = (src.fx as Record<string, number>)[c];
      if (inRange(v, 0.01, 5000)) {
        out.fx[c] = v;
        any = true;
      }
    }
    if (any && typeof src.fxDate === 'string') out.fxDate = src.fxDate;
  }
  scalar('goldTola', 10_000, 5_000_000, 'goldDate');
  scalar('silverTola', 100, 200_000);
  scalar('goldUsdOz', 100, 50_000);
  scalar('policyRate', 0, 50, 'policyDate');
  if (scalar('cpi', -20, 100) && typeof src.cpiMonth === 'string') out.cpiMonth = src.cpiMonth;
  scalar('coreCpi', -20, 100);
  scalar('npcUsd', 0, 30);
  scalar('btcUsd', 100, 10_000_000, 'btcDate');
  if (scalar('kse100', 1_000, 10_000_000, 'kse100Date')) {
    scalar('kse100Ytd', -100, 1_000);
    scalar('kse100Ath', 1_000, 10_000_000);
  }
  scalar('fedFunds', 0, 30);
  scalar('ust10y', 0, 30);
  if (src.tbill && !lock.has('tbill')) {
    for (const k of ['m1', 'm3', 'm6', 'm12'] as const) {
      const v = src.tbill[k];
      if (inRange(v, 0, 60)) out.tbill[k] = v;
    }
    if (typeof src.tbill.date === 'string') out.tbill.date = src.tbill.date;
  }
  if (src.nss && !lock.has('nss')) {
    for (const [k, v] of Object.entries(src.nss)) {
      if (!lock.has(`nss.${k}`) && inRange(v, 0, 60)) out.nss[k] = v;
    }
    if (typeof src.nssDate === 'string') out.nssDate = src.nssDate;
  }
  const x = f.extra ?? {};
  if (x.crypto?.usd) {
    const c: Record<string, number> = {};
    for (const [k, v] of Object.entries(x.crypto.usd)) if (inRange(v, 0, 10_000_000)) c[k.toUpperCase()] = v;
    if (Object.keys(c).length) {
      out.crypto = c;
      out.cryptoDate = x.crypto.asOf;
    }
  }
  if (x.kibor) {
    const k = x.kibor;
    out.kibor = { m3: k.m3?.offer, m6: k.m6?.offer, m12: k.m12?.offer, date: k.asOf };
  }
  if (x.openMarket?.rates) {
    const om: Partial<Record<Currency, { buy: number; sell: number }>> = {};
    for (const c of CURRENCIES) {
      const r = x.openMarket.rates[c];
      if (r && inRange(r.buy, 0.01, 5000) && inRange(r.sell, 0.01, 5000)) om[c] = { buy: r.buy, sell: r.sell };
    }
    if (Object.keys(om).length) {
      out.fxOpen = om;
      out.fxOpenDate = x.openMarket.asOf;
    }
  }
  if (x.reserves && (isNum(x.reserves.total) || isNum(x.reserves.sbp))) {
    out.reserves = { sbp: x.reserves.sbp, total: x.reserves.total, date: x.reserves.asOf };
  }
  if (x.usTreasury && inRange(x.usTreasury.y2, 0, 30)) {
    out.ust2y = x.usTreasury.y2;
    out.usDate = x.usTreasury.asOf;
  }
  if (x.psx?.indices) {
    const rows: Record<string, { v: number; chg?: number; chgPct?: number }> = {};
    for (const [k, r] of Object.entries(x.psx.indices)) {
      if (r && inRange(r.v, 100, 10_000_000)) rows[k] = { v: r.v, chg: isNum(r.chg) ? r.chg : undefined, chgPct: isNum(r.chgPct) ? r.chgPct : undefined };
    }
    if (Object.keys(rows).length) out.psxIndices = { date: x.psx.asOf, time: x.psx.time, intraday: !!x.psx.intraday, rows };
  }
  out.asOf = typeof src.asOf === 'string' ? src.asOf : f.updatedAt.slice(0, 10);
  out.feedAt = f.updatedAt;
  return out;
}

/** Arzish fund type, category and Shariah status from a MUFAP category such as
 *  'Shariah Compliant Money Market' or 'VPS-Shariah Compliant Equity'. */
export function categoryFromMufap(cat: string, sector = ''): { type: 'mutual_fund' | 'vps'; sub: string; shariah: Shariah } {
  const c = cat.toLowerCase();
  const sh: Shariah = /shariah|islamic/.test(c) ? 'yes' : 'unknown';
  const isVps = /vps|pension/.test(c) || /pension/i.test(sector);
  if (isVps) {
    const sub = /equity/.test(c) ? 'vps_equity' : /money/.test(c) ? 'vps_mm' : /debt|income/.test(c) ? 'vps_debt' : 'vps_medium';
    return { type: 'vps', sub, shariah: sh };
  }
  const islamic = sh === 'yes';
  let sub = 'income';
  if (/money\s*market|cash/.test(c)) sub = islamic ? 'islamic_mm' : 'money_market';
  else if (/index|exchange\s*traded|\betf\b/.test(c)) sub = 'index';
  else if (/equity/.test(c)) sub = islamic ? 'islamic_equity' : 'equity';
  else if (/aggressive/.test(c)) sub = 'aggressive_income';
  else if (/asset\s*alloc|balanced/.test(c)) sub = islamic ? 'islamic_aa' : 'balanced';
  else if (/capital\s*protect/.test(c)) sub = 'capital_protected';
  else if (/fund\s*of\s*funds/.test(c)) sub = 'fund_of_funds';
  else if (/commodit|gold/.test(c)) sub = 'gold_fund';
  else if (/fixed\s*(rate|return)/.test(c)) sub = 'fixed_return';
  else if (/international|feeder|global/.test(c)) sub = 'global_fund';
  else if (/income|debt|sovereign|government/.test(c)) sub = islamic ? 'islamic_income' : 'income';
  return { type: 'mutual_fund', sub, shariah: sh };
}

/** A readable label for a MUFAP row; VPS sub-funds share a scheme name, so add the sub-fund. */
export function fundLabel(f: FundNav): string {
  const { type } = categoryFromMufap(f.cat, f.sec);
  if (type !== 'vps') return f.n;
  const part = /equity/i.test(f.cat) ? 'Equity' : /money/i.test(f.cat) ? 'Money Market' : /debt|income/i.test(f.cat) ? 'Debt' : /gold|commod/i.test(f.cat) ? 'Gold' : '';
  return part ? `${f.n} (${part} sub-fund)` : f.n;
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|fund|limited|ltd)\b/g, ' ').replace(/\s+/g, ' ').trim();

/** Find the MUFAP fund a holding refers to: its linked FundID, else a single exact name match. */
export function matchFund(h: Holding, funds: FundNav[]): FundNav | null {
  if (h.type !== 'mutual_fund' && h.type !== 'vps') return null;
  if (h.feedId) return funds.find((f) => f.id === h.feedId) ?? null;
  const key = norm(h.name);
  if (key.length < 6) return null;
  let cands = funds.filter((f) => norm(f.n) === key || norm(fundLabel(f)) === key);
  if (cands.length > 1) {
    // VPS sub-funds share a name: narrow by the holding's sub-fund choice.
    const want = h.sub === 'vps_equity' ? /equity/i : h.sub === 'vps_debt' ? /debt|income/i : h.sub === 'vps_mm' ? /money/i : null;
    if (want) cands = cands.filter((f) => want.test(f.cat));
  }
  return cands.length === 1 ? cands[0] : null;
}

/** Update linked fund holdings to the latest NAV, linking exact name matches on the way.
 *  Example portfolios are left as they are. */
export function applyFundNavs(portfolios: Portfolio[], funds: FundsDoc): { portfolios: Portfolio[]; updated: number; linked: number } {
  let updated = 0;
  let linked = 0;
  const next = portfolios.map((p) => {
    if (p.isExample) return p;
    let changed = false;
    const holdings = p.holdings.map((h) => {
      const f = matchFund(h, funds.funds);
      if (!f) return h;
      const isNew = !h.feedId;
      const newer = !h.priceDate || f.d >= h.priceDate;
      if (!isNew && (!newer || h.price === f.nav)) return h;
      if (isNew) linked++;
      if (newer && h.price !== f.nav) updated++;
      changed = true;
      return { ...h, feedId: f.id, ...(newer ? { price: f.nav, priceDate: f.d } : {}) };
    });
    return changed ? { ...p, holdings } : p;
  });
  return { portfolios: next, updated, linked };
}

/** Search MUFAP funds by words in the name, AMC or category. */
export function searchFunds(funds: FundNav[], q: string, limit = 8): FundNav[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = funds.filter((f) => {
    const hay = `${f.n} ${f.amc} ${f.cat}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return hits.slice(0, limit);
}

/** USD price of a coin from the daily data, if present. */
export function cryptoUsd(m: MarketSnapshot, ticker?: string): number | undefined {
  const t = (ticker ?? '').toUpperCase();
  if (!t) return undefined;
  const v = m.crypto?.[t];
  if (isNum(v)) return v;
  return t === 'BTC' ? m.btcUsd : undefined;
}

// ---------------------------------------------------------------- PSX prices

/** PSX sector names mapped to Arzish's sector list (used for default beta and dividend yield). */
const PSX_SECTOR_MAP: [RegExp, string][] = [
  [/commercial bank/i, 'Commercial banks'],
  [/oil & gas exploration/i, 'Oil & gas exploration'],
  [/oil & gas marketing/i, 'Oil & gas marketing'],
  [/refinery/i, 'Refinery'],
  [/fertili[sz]er/i, 'Fertilizer'],
  [/cement/i, 'Cement'],
  [/power generation/i, 'Power generation'],
  [/technology|communication/i, 'Technology'],
  [/automobile/i, 'Automobiles'],
  [/pharma/i, 'Pharmaceuticals'],
  [/food|sugar|vanaspati/i, 'Food & personal care'],
  [/chemical|synthetic/i, 'Chemicals'],
  [/textile|woollen|jute|apparel/i, 'Textiles'],
  [/engineering/i, 'Steel & engineering'],
  [/insurance/i, 'Insurance'],
  [/inv\. banks|investment|securities/i, 'Holding companies'],
  [/paper|packaging/i, 'Paper & packaging'],
  [/glass|ceramic/i, 'Glass & ceramics'],
  [/cable|electrical/i, 'Electrical goods'],
  [/transport/i, 'Transport'],
  [/tobacco/i, 'Tobacco'],
  [/leather|tanner/i, 'Leather & footwear'],
  [/exchange traded/i, 'ETF'],
];

export function sectorFromPsx(sec?: string): string {
  if (!sec) return 'Other';
  for (const [re, name] of PSX_SECTOR_MAP) if (re.test(sec)) return name;
  return 'Other';
}

/** 'Oil & Gas Development Company Limited' -> 'Oil & Gas Development Company'. */
export function companyName(n: string): string {
  return n.replace(/\s+/g, ' ').replace(/\s*\(?\b(limited|ltd\.?)\)?\s*$/i, '').trim() || n.trim();
}

/** The quote for a ticker; PSX symbols are matched without case. */
export function psxQuote(psx: PsxDoc | null | undefined, ticker?: string): PsxQuote | undefined {
  const t = (ticker ?? '').trim().toUpperCase();
  if (!psx || !t) return undefined;
  return psx.stocks.find((q) => q.s === t);
}

/** Date of a quote's price. */
export const quoteDate = (psx: PsxDoc, q: PsxQuote): string => q.d ?? psx.asOf;

/** Update PSX shares and ETFs to the daily price. Example portfolios, holdings set to keep their
 *  typed price, and prices typed in after the quote's date are left alone. */
export function applyPsxPrices(portfolios: Portfolio[], psx: PsxDoc): { portfolios: Portfolio[]; updated: number } {
  const bySym = new Map(psx.stocks.map((q) => [q.s, q]));
  let updated = 0;
  const next = portfolios.map((p) => {
    if (p.isExample) return p;
    let changed = false;
    const holdings = p.holdings.map((h) => {
      if ((h.type !== 'psx_stock' && h.type !== 'psx_etf') || h.autoPrice === false || !h.ticker) return h;
      const q = bySym.get(h.ticker.trim().toUpperCase());
      if (!q) return h;
      const d = quoteDate(psx, q);
      if (h.priceDate && d < h.priceDate) return h;
      if (h.price === q.p && h.priceDate === d && h.priceSrc === 'psx') return h;
      if (h.price !== q.p) updated++;
      changed = true;
      return { ...h, price: q.p, priceDate: d, priceSrc: 'psx' as const, ...(h.sector ? {} : h.type === 'psx_stock' ? { sector: sectorFromPsx(q.sec) } : {}) };
    });
    return changed ? { ...p, holdings } : p;
  });
  return { portfolios: next, updated };
}

/** Search PSX symbols: an exact symbol first, then symbols starting with the text, then names
 *  containing every word; larger companies first within each group. */
export function searchPsx(psx: PsxDoc, q: string, opts: { etf?: boolean } = {}, limit = 8): PsxQuote[] {
  const t = q.trim().toUpperCase();
  if (!t) return [];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const pool = psx.stocks.filter((x) => (opts.etf === undefined ? true : !!x.etf === opts.etf));
  const bySize = (a: PsxQuote, b: PsxQuote) => (b.mcB ?? 0) - (a.mcB ?? 0);
  const exact = pool.filter((x) => x.s === t);
  const starts = pool.filter((x) => x.s !== t && x.s.startsWith(t)).sort(bySize);
  const named = pool.filter((x) => x.s !== t && !x.s.startsWith(t) && words.every((w) => `${x.s} ${x.n}`.toLowerCase().includes(w))).sort(bySize);
  return [...exact, ...starts, ...named].slice(0, limit);
}
