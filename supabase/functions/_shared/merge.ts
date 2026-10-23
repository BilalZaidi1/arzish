// Port of arzish-data/tools/merge.py: merge market data field by field, newest dated value wins.
// current = the document now stored, feed = today's scraper output, patch = the agent's or an admin's
// additions. On equal dates the patch beats the feed, which beats the current document.
// National Savings rates merge per scheme ("nss.RIC" dates).

type Doc = {
  market?: Record<string, unknown>;
  dates?: Record<string, string>;
  sources?: Record<string, string>;
  sourceInfo?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  status?: Record<string, unknown>;
  builtAt?: string;
  notes?: string[];
  review?: string[];
  [k: string]: unknown;
};

const NSS_FROM_FILES = ['SSC', 'DSC', 'STSC', 'SITA3', 'SITA5'];
const DERIVED = new Set(['asOf', 'fxDate', 'goldDate', 'btcDate', 'nssDate', 'cpiMonth', 'policyDate', 'kse100Date', 'sp500Date']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dateOf = (d: Doc, key: string): string => String((d.dates ?? {})[key] ?? '');

export function merge(current: Doc, feed: Doc, patch: Doc, today: string): Doc {
  const layers: [string, Doc][] = [['current', current], ['feed', feed], ['patch', patch]];
  const market: Record<string, unknown> = {};
  const dates: Record<string, string> = {};
  const sources: Record<string, string> = {};
  const keys = new Set<string>();
  for (const [, d] of layers) for (const k of Object.keys(d.market ?? {})) keys.add(k);
  keys.delete('nss');
  for (const k of DERIVED) keys.delete(k);

  for (const k of [...keys].sort()) {
    let best: { date: string; doc: Doc } | null = null;
    for (const [, d] of layers) {
      const m = d.market ?? {};
      if (!(k in m) || m[k] === null || m[k] === undefined) continue;
      const cand = { date: dateOf(d, k), doc: d };
      if (!best || cand.date >= best.date) best = cand;
    }
    if (best) {
      market[k] = (best.doc.market ?? {})[k];
      if (best.date) dates[k] = best.date;
      const src = (best.doc.sources ?? {})[k];
      if (src) sources[k] = src;
    }
  }

  // National Savings, scheme by scheme.
  const nss: Record<string, unknown> = {};
  for (const [, d] of layers) {
    const scheme = ((d.market ?? {}).nss ?? {}) as Record<string, unknown>;
    for (const [s, rate] of Object.entries(scheme)) {
      if (rate === null || rate === undefined) continue;
      const key = `nss.${s}`;
      const dd = dateOf(d, key);
      if (!(key in dates) || dd >= dates[key]) {
        nss[s] = rate;
        dates[key] = dd;
      }
    }
  }
  if (Object.keys(nss).length) {
    market.nss = nss;
    dates.nss = Object.entries(dates).filter(([k]) => k.startsWith('nss.')).map(([, v]) => v).sort().at(-1) ?? '';
  }

  const cm = current.market ?? {};
  const fm = feed.market ?? {};
  const pm = patch.market ?? {};
  market.asOf = today;
  if (dates.fx) market.fxDate = dates.fx;
  if (dates.goldTola) market.goldDate = dates.goldTola;
  if (dates.btcUsd) market.btcDate = dates.btcUsd;
  if (dates.nss) market.nssDate = [dates.nss, String(fm.nssDate ?? '')].sort().at(-1);
  if (dates.cpi && dates.cpi.length >= 7) {
    const y = Number(dates.cpi.slice(0, 4));
    const mth = Number(dates.cpi.slice(5, 7));
    market.cpiMonth = `${MONTHS[mth - 1]} ${y}`;
  }
  if (pm.policyDate) market.policyDate = pm.policyDate;
  else if (cm.policyRate !== undefined && cm.policyRate !== null && market.policyRate !== undefined && market.policyRate !== cm.policyRate) market.policyDate = today;
  else if (cm.policyDate || fm.policyDate) market.policyDate = cm.policyDate || fm.policyDate;
  if (dates.kse100) market.kse100Date = dates.kse100;
  else if (cm.kse100Date) market.kse100Date = cm.kse100Date;
  if (cm.sp500Date) market.sp500Date = cm.sp500Date;

  const extra = { ...(current.extra ?? {}), ...(feed.extra ?? {}), ...(patch.extra ?? {}) } as Record<string, unknown>;

  const review: string[] = [];
  const eff = String(fm.nssDate ?? '');
  const staleNss = NSS_FROM_FILES.filter((s) => (dates[`nss.${s}`] ?? '') < eff);
  if (staleNss.length) review.push(`nss: CDNS rates effective ${eff}; still old for ${staleNss.join(', ')}`);
  const metalsDate = String(((extra.metals ?? {}) as Record<string, unknown>).asOf ?? '');
  if ((dates.goldTola ?? '') < metalsDate || (dates.silverTola ?? '') < metalsDate) review.push(`gold: Sarafa gold/silver per tola older than ${metalsDate}`);
  if (cm.policyRate !== undefined && cm.policyRate !== null && market.policyRate !== undefined && market.policyRate !== cm.policyRate) {
    review.push(`policy: SBP policy rate ${cm.policyRate} -> ${market.policyRate}; confirm the decision date (policyDate)`);
  }

  return {
    v: 1,
    updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    market,
    dates,
    sources,
    sourceInfo: { ...(current.sourceInfo ?? {}), ...(feed.sourceInfo ?? {}), ...(patch.sourceInfo ?? {}) },
    extra,
    status: feed.status ?? current.status ?? {},
    builtAt: feed.builtAt,
    notes: [...(patch.notes ?? [])],
    review,
  };
}
