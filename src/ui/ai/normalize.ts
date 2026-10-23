// Turns loosely structured holdings (AI extraction, CSV rows) into valid Holding objects.

import { CRYPTO_TICKERS, DEPOSIT_KINDS, FUND_CATEGORIES, FX_KINDS, GLOBAL_TICKERS, GOVT_KINDS, NSS_PRODUCTS, PSX_ETFS, PSX_TICKERS, TYPE_META, VPS_SCHEMES } from '../../engine/catalog';
import { todayISO, uid } from '../../engine/format';
import type { AssetType, Currency, Holding, MarketSnapshot } from '../../engine/types';
import { CURRENCIES } from '../../engine/types';

const TYPES = Object.keys(TYPE_META) as AssetType[];

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, '').replace(/^(rs\.?|pkr|\$|usd)/i, ''));
  return isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, 120) : undefined;
}

function isoDate(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = Date.parse(s);
  if (!isFinite(d)) return undefined;
  return new Date(d).toISOString().slice(0, 10);
}

/** Guess the asset type from a ticker or name when the source did not say. */
function guessType(r: Record<string, unknown>): AssetType {
  const t = (str(r.ticker) ?? '').toUpperCase();
  const name = (str(r.name) ?? '').toLowerCase();
  if (PSX_TICKERS.some((x) => x.ticker === t)) return 'psx_stock';
  if (PSX_ETFS.some((x) => x.ticker === t)) return 'psx_etf';
  if (CRYPTO_TICKERS.some((x) => x.ticker === t)) return 'crypto';
  if (GLOBAL_TICKERS.some((x) => x.ticker === t)) return 'global_etf';
  if (/fund|nav/.test(name)) return 'mutual_fund';
  if (/certificate|behbood|bsc|ric|dsc|ssc|sarwa|national savings/.test(name)) return 'nss';
  if (/t-?bill|pib|sukuk|treasury/.test(name)) return 'govt_sec';
  if (/gold|tola/.test(name)) return 'gold';
  if (/plot|house|flat|apartment|shop|land|property/.test(name)) return 'property';
  if (/saving|deposit|account|tdr/.test(name)) return 'deposit';
  return 'custom';
}

export function normalizeHolding(raw: unknown, m: MarketSnapshot): Holding | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  let type = str(r.type) as AssetType | undefined;
  if (!type || !TYPES.includes(type)) type = guessType(r);
  const meta = TYPE_META[type];
  const ticker = str(r.ticker)?.toUpperCase();
  let currency = (str(r.currency)?.toUpperCase() as Currency) ?? meta.currency;
  if (!CURRENCIES.includes(currency)) currency = meta.currency;
  let qty = num(r.qty) ?? num(r.quantity) ?? num(r.units) ?? num(r.shares);
  let price = num(r.price) ?? num(r.nav) ?? num(r.unitPrice);
  const amount = num(r.amount) ?? num(r.value) ?? num(r.marketValue) ?? num(r.balance);
  const qtyOne = ['nss', 'govt_sec', 'deposit', 'cash', 'fx_cash', 'property', 'retirement', 'business', 'custom'].includes(type);
  if (qtyOne) {
    if (price === undefined && amount !== undefined) price = amount;
    if (qty !== undefined && price !== undefined && qty !== 1 && amount === undefined) price = qty * price;
    qty = 1;
  } else if ((qty === undefined || price === undefined) && amount !== undefined) {
    if (qty !== undefined && qty > 0) price = amount / qty;
    else if (price !== undefined && price > 0) qty = amount / price;
  }
  if (qty === undefined || !(qty > 0)) return null;
  if (price === undefined || price < 0) price = 0;
  let name = str(r.name) ?? ticker ?? meta.label;
  let sub = str(r.sub);
  let sector = str(r.sector);
  const known = PSX_TICKERS.find((x) => x.ticker === ticker) ?? PSX_ETFS.find((x) => x.ticker === ticker);
  if (known && (type === 'psx_stock' || type === 'psx_etf')) {
    name = str(r.name) ?? known.name;
    sector = sector ?? known.sector;
  }
  const validSub = (list: { key: string }[]) => (sub && list.some((x) => x.key === sub) ? sub : undefined);
  if (type === 'mutual_fund') sub = validSub(FUND_CATEGORIES) ?? (/islamic/i.test(name) ? (/money|cash/i.test(name) ? 'islamic_mm' : /income/i.test(name) ? 'islamic_income' : 'islamic_equity') : /money|cash/i.test(name) ? 'money_market' : /income/i.test(name) ? 'income' : /balanced|allocation/i.test(name) ? 'balanced' : 'equity');
  if (type === 'vps') sub = validSub(VPS_SCHEMES) ?? 'vps_medium';
  if (type === 'nss') sub = validSub(NSS_PRODUCTS) ?? 'RIC';
  if (type === 'deposit') sub = validSub(DEPOSIT_KINDS) ?? 'savings';
  if (type === 'govt_sec') sub = validSub(GOVT_KINDS) ?? 'tbill';
  if (type === 'fx_cash') sub = validSub(FX_KINDS) ?? 'fcy_deposit';
  if (type === 'crypto') {
    const k = CRYPTO_TICKERS.find((x) => x.ticker === ticker);
    sub = k?.kind ?? sub ?? 'alt';
    currency = 'USD';
  }
  const h: Holding = {
    id: uid('h'),
    type,
    name,
    ticker,
    sub,
    account: str(r.account) ?? 'Self',
    currency,
    qty,
    unit: str(r.unit) ?? meta.unit,
    price,
    avgCost: num(r.avgCost) ?? num(r.cost),
    purchaseDate: isoDate(r.purchaseDate) ?? isoDate(r.date),
    priceDate: todayISO(),
    sector,
    rate: num(r.rate),
    maturity: isoDate(r.maturity),
  };
  if (type === 'gold' || type === 'silver') {
    h.unit = /gram|gm|\bg\b/i.test(String(r.unit ?? '')) ? 'gram' : 'tola';
    h.karat = num(r.karat) ?? 24;
    if (!price) {
      h.useMarketPrice = true;
      h.price = type === 'gold' ? m.goldTola : m.silverTola;
    }
  }
  if (qtyOne && h.avgCost !== undefined && h.avgCost > 0 && h.avgCost < 1) h.avgCost = undefined;
  return h;
}

/** Minimal CSV parser with quoted fields. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const clean = rows.filter((r) => r.some((c) => c.trim()));
  if (clean.length < 2) return [];
  const head = clean[0].map((h) => h.trim().replace(/^﻿/, ''));
  return clean.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
