// Sunday digest: the week's change in each user's portfolios, biggest movers, coming maturities and a
// short market recap, built from the daily snapshots and price history.
import { admin, logJob, todayPKT } from '../_shared/shared.ts';
import { appUrl, esc, layout, list, sendEmail, table, unsubscribeUrl } from '../_shared/email.ts';
// @ts-ignore: bundled engine, plain JS
import * as E from '../_engine/engine.js';

type Json = Record<string, any>;
const DAY = 864e5;
const rs = (v: number): string => E.fmtMoney(v, { currency: 'PKR', style: 'lakh', compact: true });
const sign = (v: number, d = 1): string => `${v > 0 ? '+' : ''}${v.toFixed(d)}%`;
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);

async function indexWeek(code: string, today: string): Promise<{ now?: number; then?: number; d?: string }> {
  const { data } = await admin.from('price_history').select('d, v').eq('kind', 'index').eq('code', code).gte('d', iso(Date.parse(today) - 10 * DAY)).order('d');
  if (!data || !data.length) return {};
  const last = data.at(-1)!;
  const weekAgo = [...data].reverse().find((r: Json) => r.d <= iso(Date.parse(last.d) - 7 * DAY));
  return { now: Number(last.v), then: weekAgo ? Number(weekAgo.v) : undefined, d: last.d };
}

async function movers(ws: Json, today: string): Promise<string[]> {
  const holdings: Json[] = (ws.portfolios ?? []).filter((p: Json) => !p.isExample).flatMap((p: Json) => p.holdings ?? []);
  const codes = new Map<string, { kind: string; name: string }>();
  for (const h of holdings) {
    if ((h.type === 'psx_stock' || h.type === 'psx_etf') && h.ticker) codes.set(`psx:${String(h.ticker).toUpperCase()}`, { kind: 'psx', name: String(h.ticker).toUpperCase() });
    if (h.feedId) codes.set(`fund:${h.feedId}`, { kind: 'fund', name: h.name });
  }
  const rows: { name: string; ch: number }[] = [];
  for (const [key, meta] of codes) {
    const code = key.split(':')[1];
    const { data } = await admin.from('price_history').select('d, v').eq('kind', meta.kind).eq('code', code).gte('d', iso(Date.parse(today) - 10 * DAY)).order('d');
    if (!data || data.length < 2) continue;
    const last = data.at(-1)!;
    const base = [...data].reverse().find((r: Json) => r.d <= iso(Date.parse(last.d) - 7 * DAY)) ?? data[0];
    if (Number(base.v) > 0 && base.d !== last.d) rows.push({ name: meta.name, ch: (Number(last.v) / Number(base.v) - 1) * 100 });
  }
  rows.sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch));
  return rows.slice(0, 5).map((r) => `${esc(r.name)}: <strong>${sign(r.ch)}</strong>`);
}

export async function runDigest(force = false): Promise<Json> {
  const today = todayPKT();
  const info: Json = { today, sent: 0, skipped: 0, errors: [] as string[] };
  try {
    const { data: latestRow } = await admin.from('market_docs').select('doc').eq('id', 'latest').maybeSingle();
    const m: Json = latestRow?.doc?.market ?? {};
    const kse = await indexWeek('KSE100', today);
    const recap: [string, string][] = [];
    if (kse.now) recap.push(['KSE-100', `${Math.round(kse.now).toLocaleString('en-US')}${kse.then ? ` (${sign((kse.now / kse.then - 1) * 100)} this week)` : ''}`]);
    if (m.fx?.USD) recap.push(['US dollar', `Rs ${Number(m.fx.USD).toFixed(2)}`]);
    if (m.goldTola) recap.push(['Gold, 24k per tola', rs(Number(m.goldTola))]);
    if (m.policyRate !== undefined) recap.push(['SBP policy rate', `${m.policyRate}%`]);
    if (m.tbill?.m12) recap.push(['12-month T-bill', `${Number(m.tbill.m12).toFixed(2)}%`]);

    const { data: profiles } = await admin.from('profiles').select('id, email, disabled').eq('disabled', false);
    const { data: prefsRows } = await admin.from('notification_prefs').select('user_id, digest, unsubscribe_token');
    const prefsBy = new Map<string, Json>((prefsRows ?? []).map((p: Json) => [p.user_id, p]));
    const weekAgoIso = new Date(Date.now() - 6 * DAY).toISOString();

    for (const p of profiles ?? []) {
      try {
        const pr = prefsBy.get(p.id);
        if (!p.email || (pr?.digest ?? 'weekly') !== 'weekly') {
          info.skipped++;
          continue;
        }
        if (!force) {
          const { data: sent } = await admin.from('email_log').select('id').eq('user_id', p.id).eq('kind', 'digest').eq('status', 'sent').gte('created_at', weekAgoIso).limit(1);
          if (sent && sent.length) {
            info.skipped++;
            continue;
          }
        }
        const { data: wsRow } = await admin.from('workspaces').select('ws').eq('user_id', p.id).maybeSingle();
        const ws = wsRow?.ws ? E.migrateWorkspace(wsRow.ws) : null;
        if (!ws) {
          info.skipped++;
          continue;
        }
        const own = (ws.portfolios ?? []).filter((x: Json) => !x.isExample);
        if (!own.length) {
          info.skipped++;
          continue;
        }
        const rows: [string, string][] = [];
        let totalNow = 0, totalThen = 0, haveThen = true;
        for (const port of own) {
          const { data: snaps } = await admin.from('portfolio_snapshots').select('d, value_pkr').eq('user_id', p.id).eq('portfolio_id', port.id).gte('d', iso(Date.now() - 10 * DAY)).order('d');
          if (!snaps || !snaps.length) continue;
          const now = Number(snaps.at(-1)!.value_pkr);
          const base = [...snaps].reverse().find((s: Json) => s.d <= iso(Date.parse(snaps.at(-1)!.d) - 7 * DAY));
          totalNow += now;
          if (base) totalThen += Number(base.value_pkr);
          else haveThen = false;
          rows.push([port.name, `${rs(now)}${base && Number(base.value_pkr) > 0 ? ` (${sign((now / Number(base.value_pkr) - 1) * 100)})` : ''}`]);
        }
        if (!rows.length) {
          info.skipped++;
          continue;
        }
        const change = haveThen && totalThen > 0 ? (totalNow / totalThen - 1) * 100 : null;
        const moves = await movers(ws, today);
        // Maturities in the next 30 days.
        const soon: string[] = [];
        for (const h of own.flatMap((x: Json) => x.holdings ?? [])) {
          const mat = typeof h.maturity === 'string' ? h.maturity.slice(0, 10) : null;
          if (mat && mat >= today && mat <= iso(Date.parse(today) + 30 * DAY)) soon.push(`${esc(h.name)}: ${E.fmtDate(mat)}`);
        }
        const unsub = pr?.unsubscribe_token ? await unsubscribeUrl(pr.unsubscribe_token, 'digest') : undefined;
        const title = change === null ? `Your portfolio: ${rs(totalNow)}` : `Your portfolio ${change >= 0 ? 'rose' : 'fell'} ${Math.abs(change).toFixed(1)}% this week`;
        const body = [
          table(rows),
          moves.length ? `<h2 style="font-size:15px;margin:18px 0 4px">Biggest moves this week</h2>${list(moves)}` : '',
          soon.length ? `<h2 style="font-size:15px;margin:18px 0 4px">Maturing in the next 30 days</h2>${list(soon)}` : '',
          recap.length ? `<h2 style="font-size:15px;margin:18px 0 4px">Markets</h2>${table(recap)}` : '',
        ].join('');
        const open = await appUrl('/app');
        const settings = await appUrl('/app#notifications');
        const html = layout({ title, preheader: `Portfolio ${rs(totalNow)}${kse.now ? ` · KSE-100 ${Math.round(kse.now).toLocaleString('en-US')}` : ''}`, body, cta: open.startsWith('http') ? { label: 'Open Arzish', url: open } : undefined, settingsUrl: settings.startsWith('http') ? settings : undefined, unsubscribeUrl: unsub, note: 'Figures use closing prices and the latest NAVs.' });
        const text = `${title}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${recap.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nUnsubscribe from the digest: ${unsub ?? ''}`;
        const r = await sendEmail({ to: p.email, subject: title, html, text, kind: 'digest', userId: p.id, unsubscribeUrl: unsub, idempotencyKey: `digest-${p.id}-${today}` });
        if (r.ok) info.sent++;
        else info.errors.push(`${p.id.slice(0, 8)}: ${r.error}`);
      } catch (e) {
        info.errors.push(`${p.id.slice(0, 8)}: ${(e as Error).message}`.slice(0, 200));
      }
    }
    await logJob('digest', info.errors.length === 0, info);
    return { ok: true, ...info };
  } catch (e) {
    info.errors.push((e as Error).message);
    await logJob('digest', false, info);
    return { ok: false, ...info };
  }
}
