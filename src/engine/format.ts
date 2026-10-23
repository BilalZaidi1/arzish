// Number, money and date formatting. Pakistani lakh/crore and international styles.

export type NumberStyle = 'lakh' | 'intl';

export interface MoneyOpts {
  currency?: 'PKR' | 'USD';
  style?: NumberStyle;
  compact?: boolean;
  decimals?: number;
  sign?: boolean;
}

const LAKH = 1e5;
const CRORE = 1e7;

function trimZeros(s: string): string {
  if (s.indexOf('.') < 0) return s;
  return s.replace(/\.?0+$/, '');
}

/** Group digits in the South Asian style: 12,34,56,789 */
export function groupLakh(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  let rest = intPart.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return parts.join(',') + ',' + last3;
}

export function groupIntl(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Full number with grouping, e.g. 1,23,456 or 123,456 */
export function fmtNum(v: number, style: NumberStyle = 'intl', decimals = 0): string {
  if (!isFinite(v)) return '–';
  const neg = v < 0;
  const abs = Math.abs(v);
  const fixed = abs.toFixed(decimals);
  const [i, d] = fixed.split('.');
  const g = style === 'lakh' ? groupLakh(i) : groupIntl(i);
  return (neg ? '-' : '') + g + (d ? '.' + d : '');
}

function compactLakh(abs: number): string {
  if (abs >= CRORE) {
    const cr = abs / CRORE;
    const dec = cr >= 1000 ? 0 : cr >= 100 ? 1 : 2;
    return trimZeros(cr.toFixed(dec)).replace(/^(\d+)/, (m) => groupLakh(m)) + ' Cr';
  }
  if (abs >= LAKH) {
    const l = abs / LAKH;
    return trimZeros(l.toFixed(l >= 10 ? 1 : 2)) + ' lakh';
  }
  return fmtNum(abs, 'lakh');
}

function compactIntl(abs: number): string {
  if (abs >= 1e12) return trimZeros((abs / 1e12).toFixed(2)) + 'T';
  if (abs >= 1e9) return trimZeros((abs / 1e9).toFixed(abs >= 1e11 ? 0 : 2)) + 'B';
  if (abs >= 1e6) return trimZeros((abs / 1e6).toFixed(abs >= 1e8 ? 0 : abs >= 1e7 ? 1 : 2)) + 'M';
  if (abs >= 1e4) return trimZeros((abs / 1e3).toFixed(1)) + 'K';
  return fmtNum(abs, 'intl');
}

/** Format money. Value must already be in the target currency. */
export function fmtMoney(v: number, o: MoneyOpts = {}): string {
  if (v === null || v === undefined || !isFinite(v)) return '–';
  const currency = o.currency ?? 'PKR';
  const style = o.style ?? 'lakh';
  const neg = v < 0;
  const abs = Math.abs(v);
  let body: string;
  if (currency === 'USD') {
    body = o.compact ? compactIntl(abs) : fmtNum(abs, 'intl', o.decimals ?? (abs < 100 ? 2 : 0));
    body = '$' + body;
  } else {
    if (o.compact) body = style === 'lakh' ? compactLakh(abs) : compactIntl(abs);
    else body = fmtNum(abs, style, o.decimals ?? 0);
    body = 'Rs ' + body;
  }
  const sign = neg ? '-' : o.sign && v > 0 ? '+' : '';
  return sign + body;
}

export function fmtPct(v: number, decimals = 1, sign = false): string {
  if (v === null || v === undefined || !isFinite(v)) return '–';
  const s = v.toFixed(decimals);
  return (sign && v > 0 ? '+' : '') + s + '%';
}

/** v is a fraction (0.123 -> 12.3%) */
export function fmtFrac(v: number, decimals = 1, sign = false): string {
  return fmtPct(v * 100, decimals, sign);
}

export function fmtQty(v: number, maxDec = 4): string {
  if (!isFinite(v)) return '–';
  const dec = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 1 ? Math.min(2, maxDec) : maxDec;
  return trimZeros(fmtNum(v, 'intl', dec));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = MONTHS;

/** 2026-10-21 -> 21 Oct 2026 (no timezone shifts: parse the string). */
export function fmtDate(iso?: string): string {
  if (!iso) return '–';
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso);
  if (!m) return iso;
  const y = m[1];
  const mo = MONTHS[Number(m[2]) - 1] ?? '';
  return m[3] ? `${Number(m[3])} ${mo} ${y}` : `${mo} ${y}`;
}

export function fmtMonthYear(iso?: string): string {
  if (!iso) return '–';
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole months from `fromISO` to `toISO` (can be negative). */
export function monthsBetween(fromISO: string, toISO: string): number {
  const a = /^(\d{4})-(\d{2})/.exec(fromISO);
  const b = /^(\d{4})-(\d{2})/.exec(toISO);
  if (!a || !b) return 0;
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
}

export function addMonthsISO(iso: string, months: number): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso);
  if (!m) return iso;
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1 + months;
  y += Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  const d = m[3] ? Math.min(Number(m[3]), 28) : 1;
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function yearsBetween(fromISO: string, toISO: string): number {
  return monthsBetween(fromISO, toISO) / 12;
}

export function uid(prefix = 'id'): string {
  const r = Math.random().toString(36).slice(2, 9);
  const t = Date.now().toString(36).slice(-4);
  return `${prefix}_${t}${r}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function round(v: number, d = 2): number {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

/** Axis-friendly compact label for chart ticks. */
export function axisMoney(v: number, currency: 'PKR' | 'USD', style: NumberStyle): string {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  const neg = v < 0 ? '-' : '';
  if (currency === 'USD') return neg + '$' + compactIntl(abs);
  if (style === 'lakh') {
    if (abs >= CRORE) return neg + trimZeros((abs / CRORE).toFixed(abs >= 1e9 ? 0 : abs >= 1e8 ? 1 : 2)) + ' Cr';
    if (abs >= LAKH) return neg + trimZeros((abs / LAKH).toFixed(abs >= 10 * LAKH ? 0 : 1)) + ' L';
    if (abs >= 1000) return neg + trimZeros((abs / 1000).toFixed(abs >= 10000 ? 0 : 1)) + 'K';
    return neg + String(Math.round(abs));
  }
  return neg + compactIntl(abs);
}
