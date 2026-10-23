import { useMemo } from 'react';
import { axisMoney, fmtFrac, fmtMoney, fmtPct } from '../engine/format';
import { useWS } from '../state/store';

export interface Fmt {
  base: 'PKR' | 'USD';
  style: 'lakh' | 'intl';
  /** Convert a PKR amount to the base currency at today's rate. */
  conv: (pkr: number) => number;
  /** Format a PKR amount in the base currency (compact by default). */
  money: (pkr: number, o?: { compact?: boolean; sign?: boolean; decimals?: number }) => string;
  /** Format an amount that is already in the base currency. */
  base$: (v: number, o?: { compact?: boolean; sign?: boolean; decimals?: number }) => string;
  pkr: (v: number, compact?: boolean) => string;
  usd: (v: number, compact?: boolean) => string;
  /** Single-argument compact formatters, safe to hand to chart libraries (which pass extra arguments). */
  baseC: (v: number) => string;
  pkrC: (v: number) => string;
  usdC: (v: number) => string;
  moneyC: (pkr: number) => string;
  axis: (v: number) => string;
  axisPkr: (v: number) => string;
  pct: (v: number, d?: number, sign?: boolean) => string;
  frac: (v: number, d?: number, sign?: boolean) => string;
}

export function useFmt(): Fmt {
  const { ws } = useWS();
  const { baseCurrency, numberStyle } = ws.settings;
  const usdRate = ws.market.fx.USD;
  return useMemo(() => {
    const conv = (pkr: number) => (baseCurrency === 'USD' ? pkr / usdRate : pkr);
    const base$ = (v: number, o?: { compact?: boolean; sign?: boolean; decimals?: number }) => {
      // Chart libraries may call formatters with extra non-object arguments; ignore those.
      const opt = o && typeof o === 'object' ? o : {};
      return fmtMoney(v, { currency: baseCurrency, style: numberStyle, compact: opt.compact ?? true, sign: opt.sign, decimals: opt.decimals });
    };
    const pkr = (v: number, compact = true) => fmtMoney(v, { currency: 'PKR', style: numberStyle, compact: compact !== false });
    const usd = (v: number, compact = true) => fmtMoney(v, { currency: 'USD', compact: compact !== false });
    return {
      base: baseCurrency,
      style: numberStyle,
      conv,
      money: (p, o) => base$(conv(p), o),
      base$,
      pkr,
      usd,
      baseC: (v: number) => base$(v),
      pkrC: (v: number) => pkr(v, true),
      usdC: (v: number) => usd(v, true),
      moneyC: (p: number) => base$(conv(p)),
      axis: (v: number) => axisMoney(v, baseCurrency, numberStyle),
      axisPkr: (v: number) => axisMoney(v, 'PKR', numberStyle),
      pct: fmtPct,
      frac: fmtFrac,
    };
  }, [baseCurrency, numberStyle, usdRate]);
}
