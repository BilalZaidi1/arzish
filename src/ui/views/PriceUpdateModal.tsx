import React, { useMemo, useRef, useState } from 'react';
import { fmtQty, todayISO } from '../../engine/format';
import { aiErrorCopy, aiUnavailableCopy } from '../../state/claude';
import { useUI, useWS } from '../../state/store';
import { getSample, opusQuick } from '../ai/client';
import { Button, Callout, Modal, Spinner } from '../components/primitives';

/** Parse "TICKER price" pairs from free text (broker watchlists, WhatsApp messages, CSV). */
export function parsePriceText(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const re = /\b([A-Z][A-Z0-9.]{1,11})\b[\s:=,\-–|]*(?:Rs\.?|PKR|USD|\$)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text.toUpperCase()))) {
    const n = Number(m[2].replace(/,/g, ''));
    if (isFinite(n) && n > 0 && !out.has(m[1])) out.set(m[1], n);
  }
  return out;
}

export function PriceUpdateModal({ onClose }: { onClose: () => void }) {
  const { active, updatePortfolio } = useWS();
  const { toast } = useUI();
  const [text, setText] = useState('');
  const [aiPrices, setAiPrices] = useState<Map<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ctl = useRef<AbortController | null>(null);
  const tickers = active.holdings.filter((h) => h.ticker && !h.useMarketPrice);
  const parsed = useMemo(() => aiPrices ?? parsePriceText(text), [text, aiPrices]);
  const matches = tickers
    .map((h) => ({ h, next: parsed.get(h.ticker!.toUpperCase()) }))
    .filter((x) => x.next !== undefined) as { h: (typeof tickers)[number]; next: number }[];

  const readAi = async () => {
    const s = await getSample();
    if (!s) return setErr(aiUnavailableCopy('reader'));
    setBusy(true);
    setErr('');
    ctl.current = new AbortController();
    try {
      const list = await s.json<{ ticker: string; price: number }[]>(
        `Extract the latest price for each of these tickers from the text: ${tickers.map((h) => h.ticker).join(', ')}.
Reply with only a JSON array of {"ticker": string, "price": number}. Use only prices that appear in the text; skip tickers not present. Drop commas from numbers.
Text:
"""
${text.slice(0, 40000)}
"""`,
        opusQuick({ signal: ctl.current.signal }),
      );
      const map = new Map<string, number>();
      (Array.isArray(list) ? list : []).forEach((r) => {
        const p = Number(r?.price);
        if (r?.ticker && isFinite(p) && p > 0) map.set(String(r.ticker).toUpperCase(), p);
      });
      setAiPrices(map);
    } catch (e) {
      setErr(aiErrorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    const by = new Map(matches.map((x) => [x.h.id, x.next]));
    const today = todayISO();
    updatePortfolio((p) => ({ ...p, holdings: p.holdings.map((h) => (by.has(h.id) ? { ...h, price: by.get(h.id)!, priceDate: today } : h)) }));
    toast(`${matches.length} prices updated`);
    onClose();
  };

  return (
    <Modal wide title="Update prices" onClose={onClose} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!matches.length} onClick={apply}>Update {matches.length} prices</Button>
    </>}>
      <div className="stack">
        <p className="small ink2">Paste prices from your broker app, the PSX website or a message, as “TICKER price” pairs. Gold, silver and bitcoin set to the market rate update from the Markets screen instead.</p>
        <textarea className="input" rows={6} value={text} onChange={(e) => { setText(e.target.value); setAiPrices(null); }} placeholder={tickers.slice(0, 4).map((h) => `${h.ticker} ${fmtQty(h.price, 2)}`).join('\n') || 'OGDC 268.4\nMEBL 425'} aria-label="Prices text" />
        <div className="row">
          <Button variant="ai" icon="sparkle" disabled={busy || !text.trim()} onClick={readAi}>Read messy text with AI</Button>
          {busy && <Spinner />}
          <span className="small muted">{matches.length} of {tickers.length} tickers matched</span>
        </div>
        {err && <Callout tone="warn">{err}</Callout>}
        {matches.length > 0 && (
          <div className="table-wrap">
            <table className="t compact">
              <thead><tr><th>Ticker</th><th className="num">Old price</th><th className="num">New price</th><th className="num">Change</th></tr></thead>
              <tbody>
                {matches.map(({ h, next }) => {
                  const ch = h.price ? (next / h.price - 1) * 100 : 0;
                  return (
                    <tr key={h.id}>
                      <td className="mono">{h.ticker}</td>
                      <td className="num">{fmtQty(h.price, 4)}</td>
                      <td className="num strong">{fmtQty(next, 4)}</td>
                      <td className={'num ' + (ch >= 0 ? 'up' : 'down')}>{(ch >= 0 ? '+' : '') + ch.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
