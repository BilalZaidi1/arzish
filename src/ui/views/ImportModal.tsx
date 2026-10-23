import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DEPOSIT_KINDS, FUND_CATEGORIES, FX_KINDS, GOVT_KINDS, NSS_PRODUCTS, TYPE_META, VPS_SCHEMES } from '../../engine/catalog';
import { fmtQty } from '../../engine/format';
import type { Holding } from '../../engine/types';
import { valuePKR } from '../../engine/valuation';
import { aiErrorCopy, aiUnavailableCopy } from '../../state/claude';
import { useUI, useWS } from '../../state/store';
import { ownCounts, useEntitlements } from '../../state/entitlements';
import { getSample, opusQuick } from '../ai/client';
import { normalizeHolding, parseCsv } from '../ai/normalize';
import { Icon } from '../components/Icon';
import { Button, Callout, Modal, Spinner, Tabs } from '../components/primitives';
import { useFmt } from '../fmt';

export function extractionPrompt(text: string, withImages: boolean): string {
  return `You read investment statements and notes for a Pakistan-based investor and extract holdings.
Reply with ONLY a JSON array (no prose). Each item is an object with these keys (use null when unknown):
{"type": one of ${JSON.stringify(Object.keys(TYPE_META))},
 "name": string, "ticker": string|null, "sub": string|null, "currency": "PKR"|"USD"|"AED"|"SAR"|"GBP"|"EUR",
 "qty": number|null, "unit": string|null, "price": number|null, "amount": number|null, "avgCost": number|null,
 "purchaseDate": "YYYY-MM-DD"|null, "rate": number|null, "maturity": "YYYY-MM-DD"|null, "karat": number|null, "account": string|null}
Rules:
- Use only numbers that appear in the input. Never invent or estimate prices, NAVs, rates or quantities; use null instead.
- PSX shares: type psx_stock, ticker = PSX symbol, qty = shares, price = last price, avgCost = average cost per share if shown.
- Mutual funds: type mutual_fund, qty = units, price = NAV; sub one of ${JSON.stringify(FUND_CATEGORIES.map((c) => c.key))}. VPS: sub one of ${JSON.stringify(VPS_SCHEMES.map((c) => c.key))}.
- National Savings: type nss, amount = principal, sub one of ${JSON.stringify(NSS_PRODUCTS.map((p) => p.key))}.
- Deposits: type deposit, amount = balance, sub one of ${JSON.stringify(DEPOSIT_KINDS.map((d) => d.key))}. Government securities: type govt_sec, sub one of ${JSON.stringify(GOVT_KINDS.map((g) => g.key))}.
- Foreign currency accounts or Naya Pakistan Certificates: type fx_cash, currency set, amount = balance, sub one of ${JSON.stringify(FX_KINDS.map((g) => g.key))}.
- Gold or silver: qty = weight, unit "tola" or "gram", karat if stated.
- Property: amount = market value, avgCost = purchase price if stated.
- Numbers: drop commas; 1 lakh = 100000, 1 crore = 10000000. Percentages as plain numbers (12.5 not 0.125).
- Skip totals, subtotals, cash movements and transaction history; return current positions only.
${withImages ? 'The images are screenshots or photos of statements; read every position visible in them.' : ''}
Input:
"""
${text.slice(0, 60000)}
"""`;
}

export function ImportModal({ onClose }: { onClose: () => void }) {
  const { ws, active, updatePortfolio } = useWS();
  const { toast } = useUI();
  const ent = useEntitlements();
  const fmt = useFmt();
  const [tab, setTab] = useState<'ai' | 'csv'>('ai');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState<{ h: Holding; on: boolean }[] | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [imagesOk, setImagesOk] = useState(false);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    getSample().then(async (s) => {
      setAiReady(!!s);
      if (s) {
        try {
          const lim = await s.limits();
          setImagesOk(!!lim.images);
        } catch {
          setImagesOk(false);
        }
      }
    });
    return () => ctl.current?.abort();
  }, []);

  const runAi = async () => {
    setErr('');
    const s = await getSample();
    if (!s) return setErr(aiUnavailableCopy('reader'));
    if (!text.trim() && !files.length) return setErr('Paste some text or add a screenshot first.');
    setBusy(true);
    ctl.current = new AbortController();
    try {
      const out = await s.json<unknown[]>(extractionPrompt(text || '(see images)', files.length > 0), opusQuick({ signal: ctl.current.signal, images: files.length ? files : undefined }));
      const list = (Array.isArray(out) ? out : []).map((r) => normalizeHolding(r, ws.market)).filter((h): h is Holding => !!h);
      if (!list.length) setErr('No holdings were found. Try pasting the positions table only.');
      setRows(list.map((h) => ({ h, on: true })));
    } catch (e) {
      setErr(aiErrorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  const runCsv = (csv: string) => {
    setErr('');
    const recs = parseCsv(csv);
    const list = recs.map((r) => normalizeHolding(r, ws.market)).filter((h): h is Holding => !!h);
    if (!list.length) setErr('No rows could be read. The first line must be a header such as type,name,ticker,qty,price,currency.');
    setRows(list.map((h) => ({ h, on: true })));
  };

  const chosen = useMemo(() => (rows ?? []).filter((r) => r.on), [rows]);
  const add = () => {
    if (!active.isExample && ownCounts(ws.portfolios).holdings + chosen.length > ent.limit('holdings')) {
      ent.upgrade('holdings');
      return;
    }
    updatePortfolio((p) => ({ ...p, holdings: [...p.holdings, ...chosen.map((r) => r.h)] }));
    toast(`${chosen.length} holdings added`);
    onClose();
  };

  return (
    <Modal wide title="Import holdings" onClose={onClose} footer={rows ? <>
      <Button variant="ghost" onClick={() => setRows(null)}>Back</Button>
      <Button variant="primary" disabled={!chosen.length} onClick={add}>Add {chosen.length} holdings</Button>
    </> : undefined}>
      {!rows ? (
        <div className="stack">
          <Tabs value={tab} onChange={setTab} options={[{ value: 'ai', label: 'Statement or list (AI)' }, { value: 'csv', label: 'CSV file' }]} />
          {tab === 'ai' ? (
            <div className="stack">
              <p className="small ink2">Paste a broker or CDC statement, a fund account statement, or a plain list such as “300 OGDC at 265, 5 tola gold, BSC 20 lakh”. {imagesOk ? 'You can also add screenshots.' : ''} {__WEB__ ? 'The AI reads it' : 'Claude Opus 5.5 reads it'}; nothing is added until you confirm.</p>
              {aiReady === false && <Callout tone="warn">{aiUnavailableCopy('reader')}</Callout>}
              <textarea className="input" rows={8} placeholder={'MEBL 1,500 shares @ 420\nMoney market fund 230,000 units NAV 10.85\nRegular Income Certificates Rs 30 lakh at 11.76%'} value={text} onChange={(e) => setText(e.target.value)} aria-label="Statement text" />
              {imagesOk && (
                <label className="drop-zone" style={{ cursor: 'pointer' }}>
                  <input type="file" accept="image/png,image/jpeg,image/webp" multiple style={{ display: 'none' }} onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
                  <Icon name="image" size={20} />
                  <div className="small">{files.length ? `${files.length} image${files.length > 1 ? 's' : ''} selected: ${files.map((f) => f.name).join(', ')}` : 'Add statement screenshots (up to 5)'}</div>
                </label>
              )}
              <div className="row">
                <Button variant="ai" icon="sparkle" disabled={busy} onClick={runAi}>{busy ? 'Reading…' : 'Read with AI'}</Button>
                {busy && <><Spinner /><Button size="sm" variant="ghost" onClick={() => ctl.current?.abort()}>Stop</Button></>}
              </div>
            </div>
          ) : (
            <div className="stack">
              <p className="small ink2">Use the same columns as the CSV export: type, name, ticker, sub, account, currency, qty, unit, price, avgCost, purchaseDate, rate, maturity. Unknown types are guessed from the name.</p>
              <label className="drop-zone" style={{ cursor: 'pointer' }}>
                <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) runCsv(await f.text());
                }} />
                <Icon name="file" size={20} />
                <div className="small">Choose a CSV file</div>
              </label>
              <textarea className="input" rows={6} placeholder="Or paste CSV here" value={text} onChange={(e) => setText(e.target.value)} aria-label="CSV text" />
              <div><Button onClick={() => runCsv(text)}>Read CSV</Button></div>
            </div>
          )}
          {err && <Callout tone="warn">{err}</Callout>}
        </div>
      ) : (
        <div className="stack">
          <p className="small ink2">Check each row before adding. Prices that were missing are set to zero; edit them afterwards.</p>
          <div className="table-wrap">
            <table className="t compact">
              <thead><tr><th><span className="sr-only">Include</span></th><th>Type</th><th>Holding</th><th className="num">Quantity</th><th className="num">Price</th><th className="num">Value</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.h.id}>
                    <td><input type="checkbox" aria-label={`Include ${r.h.name}`} checked={r.on} onChange={(e) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} /></td>
                    <td className="small">{TYPE_META[r.h.type].label}</td>
                    <td><div className="cell-name"><span className="n1">{r.h.ticker ? `${r.h.ticker} · ` : ''}{r.h.name}</span><span className="n2">{r.h.currency}{r.h.sub ? ` · ${r.h.sub}` : ''}</span></div></td>
                    <td className="num">{fmtQty(r.h.qty)} {r.h.unit}</td>
                    <td className="num">{r.h.price ? fmtQty(r.h.price, 4) : <span style={{ color: 'var(--warn-ink)' }}>missing</span>}</td>
                    <td className="num">{fmt.money(valuePKR(r.h, ws.market))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
