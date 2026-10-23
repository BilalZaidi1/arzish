// Morning data load: read the scrapers' files from GitHub, merge them with the stored document and the
// newest agent or admin patch, keep daily price history and record market events for notifications.
import { admin, logJob, todayPKT } from '../_shared/shared.ts';
import { merge } from '../_shared/merge.ts';

const RAW = 'https://raw.githubusercontent.com/BilalZaidi1/arzish-data/main';

type Json = Record<string, any>;

async function fetchJson(path: string): Promise<Json> {
  const r = await fetch(`${RAW}/${path}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return await r.json();
}

async function upsertChunks(rows: Json[], chunk = 800): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const { error } = await admin.from('price_history').upsert(part, { onConflict: 'kind,code,d' });
    if (error) throw new Error(`price_history: ${error.message}`);
    n += part.length;
  }
  return n;
}

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

export async function loadMarket(): Promise<Json> {
  const info: Json = { at: new Date().toISOString() };
  const [feedR, psxR, fundsR] = await Promise.allSettled([fetchJson('data/feed.json'), fetchJson('data/psx.json'), fetchJson('data/funds.json')]);
  if (feedR.status !== 'fulfilled') throw new Error(`feed: ${(feedR as PromiseRejectedResult).reason}`);
  const feed = feedR.value;

  const { data: rows, error } = await admin.from('market_docs').select('id, doc');
  if (error) throw new Error(error.message);
  const cur: Record<string, Json> = Object.fromEntries((rows ?? []).map((r: Json) => [r.id, r.doc]));

  // The newest patch from the last three days; its notes only while it is from the last 30 hours.
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  const { data: patches } = await admin.from('market_patches').select('id, created_at, source, patch').gte('created_at', since).order('created_at', { ascending: false }).limit(1);
  let patch: Json = {};
  if (patches && patches.length) {
    patch = { ...(patches[0].patch as Json) };
    if (Date.now() - Date.parse(patches[0].created_at) > 30 * 3600_000) patch.notes = [];
    info.patch = { id: patches[0].id, source: patches[0].source };
  }

  const prev = cur.latest ?? {};
  const latest = merge(prev, feed, patch, todayPKT());
  const { error: e1 } = await admin.from('market_docs').upsert({ id: 'latest', doc: latest, updated_at: new Date().toISOString() });
  if (e1) throw new Error(`latest: ${e1.message}`);
  info.latest = { builtAt: latest.builtAt, review: latest.review };

  // Market events for notifications.
  const pm = (prev.market ?? {}) as Json;
  const nm = (latest.market ?? {}) as Json;
  const events: Json[] = [];
  if (prev.market && num(pm.policyRate) !== null && num(nm.policyRate) !== null && pm.policyRate !== nm.policyRate) {
    events.push({ kind: 'policy_rate', data: { from: pm.policyRate, to: nm.policyRate, date: nm.policyDate ?? todayPKT() } });
  }
  if (prev.market && pm.nss && nm.nss) {
    const changes: Json = {};
    for (const [k, v] of Object.entries(nm.nss as Json)) {
      const was = (pm.nss as Json)[k];
      if (num(v) !== null && num(was) !== null && v !== was) changes[k] = { from: was, to: v };
    }
    if (Object.keys(changes).length) events.push({ kind: 'nss_rate', data: { changes, effective: nm.nssDate ?? null } });
  }
  const prevCpi = (prev.dates ?? {}).cpi;
  const newCpi = (latest.dates ?? {}).cpi;
  if (prev.market && newCpi && prevCpi && newCpi > prevCpi) events.push({ kind: 'cpi', data: { month: nm.cpiMonth, value: nm.cpi } });
  if (events.length) await admin.from('market_events').insert(events);
  info.events = events.map((e) => e.kind);

  // PSX prices and history (closing prices only).
  const history: Json[] = [];
  if (psxR.status === 'fulfilled') {
    const psx = psxR.value;
    const newer = !cur.psx || String(psx.builtAt ?? '') > String(cur.psx.builtAt ?? '');
    if (newer && Array.isArray(psx.stocks) && psx.stocks.length > 100) {
      const { error: e2 } = await admin.from('market_docs').upsert({ id: 'psx', doc: psx, updated_at: new Date().toISOString() });
      if (e2) throw new Error(`psx: ${e2.message}`);
    }
    if (!psx.intraday && Array.isArray(psx.stocks)) {
      for (const q of psx.stocks) {
        if (typeof q?.s === 'string' && num(q.p) !== null && q.p > 0) history.push({ kind: 'psx', code: q.s, d: q.d ?? psx.asOf, v: q.p });
      }
    }
    info.psx = { asOf: psx.asOf, intraday: !!psx.intraday, count: psx.count, written: newer };
  } else info.psx = { error: String((psxR as PromiseRejectedResult).reason).slice(0, 200) };

  const px = ((latest.extra ?? {}) as Json).psx as Json | undefined;
  if (px && !px.intraday && px.asOf && px.indices) {
    for (const [k, r] of Object.entries(px.indices as Json)) {
      if (num((r as Json).v) !== null) history.push({ kind: 'index', code: k, d: px.asOf, v: (r as Json).v });
    }
  }

  if (fundsR.status === 'fulfilled') {
    const funds = fundsR.value;
    const newer = !cur.funds || String(funds.builtAt ?? '') > String(cur.funds.builtAt ?? '');
    if (newer && Array.isArray(funds.funds) && funds.funds.length > 100) {
      const { error: e3 } = await admin.from('market_docs').upsert({ id: 'funds', doc: funds, updated_at: new Date().toISOString() });
      if (e3) throw new Error(`funds: ${e3.message}`);
    }
    for (const f of funds.funds ?? []) {
      if (typeof f?.id === 'string' && num(f.nav) !== null && f.nav > 0 && f.d) history.push({ kind: 'fund', code: f.id, d: f.d, v: f.nav });
    }
    info.funds = { asOf: funds.asOf, reportDate: funds.reportDate, count: funds.count, written: newer };
  } else info.funds = { error: String((fundsR as PromiseRejectedResult).reason).slice(0, 200) };

  info.history = await upsertChunks(history);
  return info;
}

/** One-time fill of index history from the open fund dataset's KSE-100 and KMI-30 closes. */
export async function backfillIndices(): Promise<Json> {
  const base = 'https://raw.githubusercontent.com/saadsalmankhan/pakistan-mutual-funds-data/main/indices';
  const out: Json = {};
  for (const code of ['KSE100', 'KMI30']) {
    const r = await fetch(`${base}/${code}.ndjson`);
    if (!r.ok) {
      out[code] = `HTTP ${r.status}`;
      continue;
    }
    const rows: Json[] = [];
    for (const line of (await r.text()).split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.date && num(o.close) !== null) rows.push({ kind: 'index', code, d: o.date, v: o.close });
      } catch {
        // skip a bad line
      }
    }
    // Keep closes the scraper already recorded.
    const { data: have } = await admin.from('price_history').select('d').eq('kind', 'index').eq('code', code);
    const seen = new Set((have ?? []).map((h: Json) => h.d));
    out[code] = await upsertChunks(rows.filter((x) => !seen.has(x.d)));
  }
  return out;
}

export async function runLoad(): Promise<Json> {
  try {
    const info = await loadMarket();
    await logJob('load-market', true, info);
    return { ok: true, ...info };
  } catch (e) {
    const info = { error: (e as Error).message.slice(0, 500) };
    await logJob('load-market', false, info);
    return { ok: false, ...info };
  }
}
