import React, { useMemo, useState } from 'react';
import { CLASS_META, LIQUIDITY_META, TYPE_META } from '../../engine/catalog';
import { fmtDate, fmtQty, todayISO, uid } from '../../engine/format';
import type { AssetClass, Holding, Liability } from '../../engine/types';
import { CLASS_ORDER } from '../../engine/types';
import {
  computeTotals, costPKR, effectiveQty, holdingClass, incomeYieldPct, liabilityPKR, liquidityOf, priceAgeDays, shariahOf, subLabel, unitPrice, valuePKR,
} from '../../engine/valuation';
import { useFilteredHoldings, useUI, useWS } from '../../state/store';
import { Icon } from '../components/Icon';
import { Badge, Button, Card, Empty, Field, Modal, NumberInput, Select, Seg } from '../components/primitives';
import { useFmt } from '../fmt';
import { ExampleBanner, PageHead, useClassColor } from './common';
import { ImportModal } from './ImportModal';
import { PriceUpdateModal } from './PriceUpdateModal';
import { saveFile } from '../download';

type GroupBy = 'class' | 'account' | 'none';
type SortKey = 'value' | 'name' | 'gain' | 'weight' | 'yield';

export function holdingsToCsv(holdings: Holding[], m: import('../../engine/types').MarketSnapshot): string {
  const cols = ['type', 'name', 'ticker', 'sub', 'account', 'currency', 'qty', 'unit', 'price', 'avgCost', 'purchaseDate', 'rate', 'maturity', 'sector', 'shariah', 'valuePKR'];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = holdings.map((h) => cols.map((c) => (c === 'valuePKR' ? Math.round(valuePKR(h, m)) : (h as unknown as Record<string, unknown>)[c])).map(esc).join(','));
  return [cols.join(','), ...rows].join('\n');
}

export function Holdings() {
  const { ws, active, updatePortfolio } = useWS();
  const { openEditor, askAI, toast, filters } = useUI();
  const holdings = useFilteredHoldings();
  const fmt = useFmt();
  const color = useClassColor();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<GroupBy>('class');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'value', dir: -1 });
  const [modal, setModal] = useState<null | 'import' | 'prices' | 'liability'>(null);
  const [editLiab, setEditLiab] = useState<Liability | null>(null);
  const m = ws.market;
  const today = todayISO();
  const t = useMemo(() => computeTotals(holdings, active.liabilities, m), [holdings, active.liabilities, m]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = holdings
      .filter((h) => !needle || [h.name, h.ticker, h.account, subLabel(h), TYPE_META[h.type].label].some((s) => (s ?? '').toLowerCase().includes(needle)))
      .map((h) => {
        const v = valuePKR(h, m);
        const c = costPKR(h, m);
        return { h, v, c, gain: c !== undefined ? v - c : undefined, gainPct: c ? (v / c - 1) * 100 : undefined, w: v / (t.assets || 1), y: incomeYieldPct(h, m) };
      });
    const val = (r: (typeof list)[number]) => {
      switch (sort.key) {
        case 'name': return (r.h.ticker ?? r.h.name).toLowerCase();
        case 'gain': return r.gainPct ?? -1e9;
        case 'weight': return r.w;
        case 'yield': return r.y;
        default: return r.v;
      }
    };
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [holdings, q, sort, m, t.assets]);

  const groups = useMemo(() => {
    if (group === 'none') return [{ key: 'all', label: '', rows }];
    if (group === 'class')
      return CLASS_ORDER.map((c) => ({ key: c, label: CLASS_META[c].label, cls: c as AssetClass, rows: rows.filter((r) => holdingClass(r.h) === c) })).filter((g) => g.rows.length);
    const accs = Array.from(new Set(rows.map((r) => r.h.account ?? 'Self')));
    return accs.map((a) => ({ key: a, label: a, rows: rows.filter((r) => (r.h.account ?? 'Self') === a) }));
  }, [rows, group]);

  const th = (key: SortKey, label: string, num = true) => (
    <th className={(num ? 'num ' : '') + 'sortable'} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 }))} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  );

  const exportCsv = async () => {
    const csv = holdingsToCsv(active.holdings, m);
    const ok = await saveFile(`arzish-holdings-${today}.csv`, csv);
    toast(ok ? 'CSV ready' : 'Download not available here; copied view opened');
  };

  const deleteLiability = (id: string) => updatePortfolio((p) => ({ ...p, liabilities: p.liabilities.filter((l) => l.id !== id) }));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Holdings"
        sub={`${active.holdings.length} holdings worth ${fmt.money(t.assets)}${active.liabilities.length ? `, less ${fmt.money(t.liabilities)} of debt` : ''}`}
        actions={<>
          <Button icon="upload" onClick={() => setModal('import')}>Import</Button>
          <Button icon="refresh" onClick={() => setModal('prices')}>Update prices</Button>
          <Button variant="ai" icon="sparkle" onClick={() => askAI('__quickadd__', false)}>Quick add with AI</Button>
          <Button variant="primary" icon="plus" onClick={() => openEditor(null)}>Add holding</Button>
        </>}
      />
      <ExampleBanner />
      <Card flush
        title={<span className="row" style={{ gap: 8 }}>Assets {active.isExample && <Badge tone="example">Illustrative prices</Badge>}</span>}
        actions={<>
          <div className="input-group" style={{ width: 220 }}>
            <span className="addon"><Icon name="search" size={14} /></span>
            <input className="input" placeholder="Search holdings" aria-label="Search holdings" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Seg size="sm" label="Group by" value={group} onChange={setGroup} options={[{ value: 'class', label: 'By class' }, { value: 'account', label: 'By account' }, { value: 'none', label: 'Flat' }]} />
          <Button size="sm" variant="ghost" icon="download" onClick={exportCsv}>CSV</Button>
        </>}
      >
        {!active.holdings.length ? (
          <Empty icon="wallet" title="No holdings yet" action={<div className="row"><Button variant="primary" icon="plus" onClick={() => openEditor(null)}>Add holding</Button><Button icon="upload" onClick={() => setModal('import')}>Import a statement</Button></div>}>
            Add holdings one by one, paste a list for the AI to read, or import a CSV.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  {th('name', 'Holding', false)}
                  <th className="hide-sm">Account</th>
                  <th className="num hide-sm">Quantity</th>
                  <th className="num hide-sm">Price</th>
                  {th('value', 'Value')}
                  {th('weight', 'Weight')}
                  {th('gain', 'Gain')}
                  {th('yield', 'Yield')}
                  <th className="hide-sm">Shariah</th>
                  <th className="hide-sm">Liquidity</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const gv = g.rows.reduce((s, r) => s + r.v, 0);
                  return (
                    <React.Fragment key={g.key}>
                      {group !== 'none' && (
                        <tr className="group">
                          <td colSpan={4}>
                            <span className="row" style={{ gap: 8 }}>
                              {'cls' in g && g.cls && <span className="swatch" style={{ background: color(g.cls as AssetClass) }} />}
                              {g.label} <span className="muted" style={{ fontWeight: 500 }}>· {g.rows.length}</span>
                            </span>
                          </td>
                          <td className="num">{fmt.money(gv)}</td>
                          <td className="num">{fmt.pct((gv / (t.assets || 1)) * 100, 1)}</td>
                          <td colSpan={5} />
                        </tr>
                      )}
                      {g.rows.map(({ h, v, gain, gainPct, w, y }) => {
                        const sh = shariahOf(h);
                        const age = priceAgeDays(h, today);
                        return (
                          <tr key={h.id}>
                            <td>
                              <button type="button" className="linkbtn" style={{ color: 'inherit', fontWeight: 'inherit', textAlign: 'left' }} onClick={() => openEditor(h)}>
                                <div className="cell-name">
                                  <span className="n1">{h.ticker ? <><span className="mono">{h.ticker}</span> · {h.name}</> : h.name}</span>
                                  <span className="n2">{subLabel(h)}</span>
                                </div>
                              </button>
                            </td>
                            <td className="hide-sm small">{h.account ?? 'Self'}</td>
                            <td className="num hide-sm">{['nss', 'govt_sec', 'deposit', 'cash', 'property', 'retirement', 'business', 'custom'].includes(h.type) ? '–' : `${fmtQty(h.qty)} ${h.unit ?? ''}`}</td>
                            <td className="num hide-sm">
                              {['nss', 'govt_sec', 'deposit', 'cash', 'property', 'retirement', 'business', 'custom', 'fx_cash'].includes(h.type) ? '–' : <>
                                {h.currency === 'PKR' ? 'Rs ' : h.currency + ' '}{fmtQty(unitPrice(h, m), 2)}
                                {h.useMarketPrice ? <div className="tiny muted">{h.type === 'crypto' ? 'daily price' : 'market rate'}</div> : h.feedId ? <div className="tiny muted">MUFAP NAV{h.priceDate ? `, ${fmtDate(h.priceDate)}` : ''}</div> : h.priceSrc === 'psx' && h.autoPrice !== false ? <div className="tiny muted">PSX{h.priceDate ? `, ${fmtDate(h.priceDate)}` : ''}</div> : age !== undefined && age > 30 ? <div className="tiny" style={{ color: 'var(--warn-ink)' }}>{age} days old</div> : null}
                              </>}
                            </td>
                            <td className="num strong">{fmt.money(v)}</td>
                            <td className="num">{fmt.pct(w * 100, 1)}</td>
                            <td className={'num ' + (gain === undefined ? 'muted' : gain >= 0 ? 'up' : 'down')}>
                              {gain === undefined ? '–' : <>{fmt.money(gain, { sign: true })}<div className="tiny">{fmt.pct(gainPct ?? 0, 1, true)}</div></>}
                            </td>
                            <td className="num">{y > 0 ? fmt.pct(y, 1) : '–'}</td>
                            <td className="hide-sm small">{sh === 'yes' ? <span className="up">Compliant</span> : sh === 'no' ? <span className="muted">No</span> : <span className="muted">Unverified</span>}</td>
                            <td className="hide-sm small nowrap">{LIQUIDITY_META[liquidityOf(h)].label}</td>
                            <td>
                              <div className="row-actions">
                                <Button size="sm" variant="ghost" iconOnly icon="edit" onClick={() => openEditor(h)}>Edit {h.name}</Button>
                                <Button size="sm" variant="ghost" iconOnly icon="copy" onClick={() => {
                                  const copy = { ...h, id: uid('h'), name: h.name + ' (copy)' };
                                  updatePortfolio((p) => ({ ...p, holdings: [...p.holdings, copy] }));
                                  toast('Holding duplicated');
                                }}>Duplicate {h.name}</Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
                <tr className="total">
                  <td colSpan={1}>Total{filters.classes.length || filters.currency !== 'all' ? ' (filtered)' : ''}</td>
                  <td className="hide-sm" colSpan={3} />
                  <td className="num">{fmt.money(t.assets)}</td>
                  <td className="num">100%</td>
                  <td className={'num ' + (t.pnl >= 0 ? 'up' : 'down')}>{t.cost > 0 ? fmt.money(t.pnl, { sign: true }) : '–'}</td>
                  <td className="num">{fmt.pct(t.incomeYield, 1)}</td>
                  <td colSpan={3} className="hide-sm" />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card flush title="Liabilities" sub="Loans reduce net worth; repayments are assumed to come from income, not the portfolio"
        actions={<Button size="sm" icon="plus" onClick={() => { setEditLiab({ id: uid('l'), type: 'car', name: '', currency: 'PKR', balance: 0, rate: 14, payment: 0 }); setModal('liability'); }}>Add liability</Button>}>
        {active.liabilities.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Liability</th><th className="num">Balance</th><th className="num">Rate</th><th className="num">Monthly payment</th><th className="hide-sm">Ends</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {active.liabilities.map((l) => (
                  <tr key={l.id}>
                    <td><div className="cell-name"><span className="n1">{l.name || l.type}</span><span className="n2">{l.type}</span></div></td>
                    <td className="num">{fmt.money(liabilityPKR(l, m))}</td>
                    <td className="num">{fmt.pct(l.rate, 1)}</td>
                    <td className="num">{fmt.money(l.payment * (m.fx[l.currency] ?? 1))}</td>
                    <td className="hide-sm small">{fmtDate(l.endDate)}</td>
                    <td><div className="row-actions">
                      <Button size="sm" variant="ghost" iconOnly icon="edit" onClick={() => { setEditLiab(l); setModal('liability'); }}>Edit</Button>
                      <Button size="sm" variant="ghost" iconOnly icon="trash" onClick={() => deleteLiability(l.id)}>Delete</Button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card-b"><p className="small muted">No liabilities recorded.</p></div>
        )}
      </Card>

      {modal === 'import' && <ImportModal onClose={() => setModal(null)} />}
      {modal === 'prices' && <PriceUpdateModal onClose={() => setModal(null)} />}
      {modal === 'liability' && editLiab && (
        <LiabilityModal value={editLiab} onClose={() => setModal(null)} onSave={(l) => {
          updatePortfolio((p) => ({ ...p, liabilities: p.liabilities.some((x) => x.id === l.id) ? p.liabilities.map((x) => (x.id === l.id ? l : x)) : [...p.liabilities, l] }));
          setModal(null);
          toast('Liability saved');
        }} />
      )}
    </div>
  );
}

function LiabilityModal({ value, onClose, onSave }: { value: Liability; onClose: () => void; onSave: (l: Liability) => void }) {
  const [l, setL] = useState<Liability>(value);
  const set = (p: Partial<Liability>) => setL((x) => ({ ...x, ...p }));
  return (
    <Modal title="Liability" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave({ ...l, name: l.name.trim() || l.type })}>Save</Button></>}>
      <div className="form-grid">
        <Field label="Type" htmlFor="l-type"><Select id="l-type" value={l.type} onChange={(v) => set({ type: v })} options={[{ value: 'mortgage', label: 'Home loan' }, { value: 'car', label: 'Car financing' }, { value: 'personal', label: 'Personal loan' }, { value: 'card', label: 'Credit card' }, { value: 'other', label: 'Other' }]} /></Field>
        <Field label="Label" htmlFor="l-name"><input id="l-name" className="input" value={l.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Currency" htmlFor="l-cur"><Select id="l-cur" value={l.currency} onChange={(v) => set({ currency: v })} options={['PKR', 'USD', 'AED', 'SAR', 'GBP', 'EUR'].map((c) => ({ value: c as Liability['currency'], label: c }))} /></Field>
        <Field label="Outstanding balance" htmlFor="l-bal"><NumberInput id="l-bal" value={l.balance} onChange={(v) => set({ balance: v ?? 0 })} groupStyle="lakh" /></Field>
        <Field label="Interest or profit rate" htmlFor="l-rate"><NumberInput id="l-rate" value={l.rate} onChange={(v) => set({ rate: v ?? 0 })} suffix="% a year" decimals={2} /></Field>
        <Field label="Monthly payment" htmlFor="l-pay"><NumberInput id="l-pay" value={l.payment} onChange={(v) => set({ payment: v ?? 0 })} groupStyle="lakh" /></Field>
        <Field label="End date" htmlFor="l-end"><input id="l-end" type="date" className="input" value={l.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || undefined })} /></Field>
      </div>
    </Modal>
  );
}

export { effectiveQty };
