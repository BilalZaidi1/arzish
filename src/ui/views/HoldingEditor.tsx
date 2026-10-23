import React, { useMemo, useState } from 'react';
import {
  CLASS_META, CRYPTO_KINDS, CRYPTO_TICKERS, DEPOSIT_KINDS, FUND_CATEGORIES, FX_KINDS, GLOBAL_TICKERS, GOVT_KINDS, NSS_PRODUCTS,
  PROPERTY_KINDS, PSX_ETFS, PSX_SECTORS, PSX_TICKERS, RETIREMENT_KINDS, TYPE_META, TYPE_ORDER, VPS_SCHEMES, fundCategory,
} from '../../engine/catalog';
import { categoryFromMufap, companyName, cryptoUsd, fundLabel, psxQuote, quoteDate, searchFunds, searchPsx, sectorFromPsx, type PsxDoc, type PsxQuote } from '../../engine/feed';
import { fmtDate, todayISO, uid } from '../../engine/format';
import type { AssetType, Currency, Holding, Liquidity, MarketSnapshot, Payout, Shariah } from '../../engine/types';
import { defaultRate, shariahOf, valuePKR } from '../../engine/valuation';
import { useFeed, useUI, useWS } from '../../state/store';
import { Button, Field, Modal, NumberInput, Select, Toggle } from '../components/primitives';
import { useFmt } from '../fmt';
import { useClassColor } from './common';

const ACCOUNTS = ['Self', 'Spouse', 'Joint', 'Child'];
/** 'PSX stock' stays 'PSX stock', 'Mutual fund' becomes 'mutual fund'. */
const lowerLabel = (s: string) => s.split(' ').map((w) => (/^[A-Z0-9&]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
/** What PSX's symbol suffixes mean. */
const SUFFIX_NOTE: Record<string, string> = { XD: 'ex-dividend', XB: 'ex-bonus', XR: 'ex-rights', XDXB: 'ex-dividend and bonus', XDXR: 'ex-dividend and rights', NC: 'defaulters’ segment' };
const qtyOneTypes: AssetType[] = ['nss', 'govt_sec', 'deposit', 'cash', 'fx_cash', 'property', 'retirement', 'business', 'custom'];

export function newHolding(type: AssetType, m: MarketSnapshot): Holding {
  const meta = TYPE_META[type];
  const base: Holding = { id: uid('h'), type, name: '', currency: meta.currency, qty: 1, price: 0, account: 'Self', priceDate: todayISO(), unit: meta.unit };
  switch (type) {
    case 'psx_stock':
      return { ...base, qty: 100, unit: 'shares' };
    case 'psx_etf':
      return { ...base, qty: 1000, unit: 'units' };
    case 'mutual_fund':
      return { ...base, sub: 'money_market', qty: 1000, unit: 'units', name: 'Money market fund' };
    case 'vps':
      return { ...base, sub: 'vps_medium', qty: 1000, unit: 'units', name: 'VPS pension plan' };
    case 'nss':
      return { ...base, sub: 'RIC', name: 'Regular Income Certificates', rate: m.nss.RIC, purchaseDate: todayISO() };
    case 'govt_sec':
      return { ...base, sub: 'tbill', name: 'Treasury bill', rate: m.tbill.m12 };
    case 'deposit':
      return { ...base, sub: 'savings', name: 'Savings account', rate: 10 };
    case 'cash':
      return { ...base, name: 'Cash in hand' };
    case 'fx_cash':
      return { ...base, sub: 'fcy_deposit', currency: 'USD', name: 'USD account', rate: 1 };
    case 'gold':
      return { ...base, name: 'Gold', unit: 'tola', karat: 24, useMarketPrice: true, price: m.goldTola };
    case 'silver':
      return { ...base, name: 'Silver', unit: 'tola', useMarketPrice: true, price: m.silverTola };
    case 'property':
      return { ...base, sub: 'apartment', name: '', propertyUse: 'self', areaUnit: 'marla', vacancyPct: 5 };
    case 'global_stock':
    case 'global_etf':
      return { ...base, currency: 'USD', qty: 10, unit: type === 'global_stock' ? 'shares' : 'units' };
    case 'global_bond':
      return { ...base, currency: 'USD', qty: 10, unit: 'units', name: '' };
    case 'crypto':
      return { ...base, ticker: 'BTC', sub: 'btc', name: 'Bitcoin', currency: 'USD', qty: 0.01, unit: 'coins', useMarketPrice: true, price: cryptoUsd(m, 'BTC') ?? m.btcUsd };
    case 'retirement':
      return { ...base, sub: 'provident', name: 'Provident fund', liquidity: 'locked' };
    case 'business':
      return { ...base, name: 'Business stake', expReturn: 15, vol: 30, liquidity: 'locked' };
    default:
      return { ...base, name: 'Custom asset', expReturn: 10, vol: 12, liquidity: 'months' };
  }
}

function TypePicker({ onPick }: { onPick: (t: AssetType) => void }) {
  const color = useClassColor();
  return (
    <div className="type-grid">
      {TYPE_ORDER.map((t) => (
        <button key={t} type="button" className="type-btn" onClick={() => onPick(t)}>
          <span className="tb-name"><span className="swatch" style={{ background: color(TYPE_META[t].cls) }} />{TYPE_META[t].label}</span>
          <span className="tb-hint">{TYPE_META[t].hint}</span>
        </button>
      ))}
    </div>
  );
}

const CUR_OPTS = (list: Currency[]) => list.map((c) => ({ value: c, label: c }));

export function HoldingEditor() {
  const { ws, active, updatePortfolio } = useWS();
  const { editor, closeEditor, toast } = useUI();
  const { psx } = useFeed();
  const fmt = useFmt();
  const existing = editor?.holding ?? null;
  const [h, setH] = useState<Holding | null>(() => (existing ? { ...existing } : editor?.type ? newHolding(editor.type, ws.market) : null));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState('');
  const m = ws.market;
  const accounts = useMemo(() => Array.from(new Set([...ACCOUNTS, ...active.holdings.map((x) => x.account ?? 'Self')])), [active.holdings]);

  if (!editor) return null;
  const set = (patch: Partial<Holding>) => setH((prev) => (prev ? { ...prev, ...patch } : prev));

  if (!h) {
    return (
      <Modal key="type-picker" title="Add a holding" onClose={closeEditor} wide>
        <p className="small ink2" style={{ marginBottom: 12 }}>Choose what you are adding. Each type asks only for what it needs.</p>
        <TypePicker onPick={(t) => setH(newHolding(t, m))} />
      </Modal>
    );
  }

  const meta = TYPE_META[h.type];
  const qtyOne = qtyOneTypes.includes(h.type);
  const cur = h.currency;
  const curSym = cur === 'PKR' ? 'Rs' : cur;

  const save = () => {
    const name = (h.name || h.ticker || '').trim();
    if (!name) return setError('Give this holding a name.');
    if (!(h.qty > 0)) return setError('Quantity must be more than zero.');
    if (!(h.price >= 0)) return setError('Enter a price or value of zero or more.');
    const priceChanged = !existing || existing.price !== h.price;
    // A fund linked to MUFAP keeps the NAV's own date, a PSX price its trading day; any other new price is dated today.
    const fromFeed = !!h.feedId || h.priceSrc === 'psx';
    const clean: Holding = { ...h, name, priceDate: fromFeed ? h.priceDate : priceChanged ? todayISO() : h.priceDate };
    updatePortfolio((p) => {
      const has = p.holdings.some((x) => x.id === clean.id);
      return { ...p, isExample: p.isExample, holdings: has ? p.holdings.map((x) => (x.id === clean.id ? clean : x)) : [...p.holdings, clean] };
    });
    toast(existing ? 'Holding updated' : 'Holding added');
    closeEditor();
  };

  const del = () => {
    updatePortfolio((p) => ({ ...p, holdings: p.holdings.filter((x) => x.id !== h.id) }));
    toast('Holding removed');
    closeEditor();
  };

  const value = valuePKR(h, m);
  const tickerList = h.type === 'psx_stock' ? PSX_TICKERS : h.type === 'psx_etf' ? PSX_ETFS : h.type === 'crypto' ? CRYPTO_TICKERS : GLOBAL_TICKERS;

  /** Fill a PSX holding from the daily price list. */
  const pickPsx = (q: PsxQuote, doc: PsxDoc) => {
    const keepPrice = h.autoPrice === false;
    set({
      ticker: q.s,
      type: q.etf ? 'psx_etf' : 'psx_stock',
      unit: q.etf ? 'units' : 'shares',
      name: companyName(q.n),
      sector: q.etf ? undefined : sectorFromPsx(q.sec),
      ...(q.sh ? { shariah: 'yes' as Shariah } : {}),
      ...(keepPrice ? {} : { price: q.p, priceDate: quoteDate(doc, q), priceSrc: 'psx' as const }),
      ...(h.yieldPct === undefined && q.dy ? { yieldPct: q.dy } : {}),
    });
  };

  const onTicker = (raw: string) => {
    const t = raw.toUpperCase().trim();
    const patch: Partial<Holding> = { ticker: t };
    const q = (h.type === 'psx_stock' || h.type === 'psx_etf') && t !== (h.ticker ?? '') ? psxQuote(psx, t) : undefined;
    if (q && psx) {
      set({ ticker: t });
      pickPsx(q, psx);
      return;
    }
    if (h.type === 'psx_stock') {
      const k = PSX_TICKERS.find((x) => x.ticker === t);
      if (k) Object.assign(patch, { name: k.name, sector: k.sector, shariah: k.shariah });
    } else if (h.type === 'psx_etf') {
      const k = PSX_ETFS.find((x) => x.ticker === t);
      if (k) Object.assign(patch, { name: k.name, shariah: k.shariah });
    } else if (h.type === 'crypto') {
      const k = CRYPTO_TICKERS.find((x) => x.ticker === t);
      if (k) Object.assign(patch, { name: k.name, sub: k.kind });
      const px = cryptoUsd(m, t);
      Object.assign(patch, px !== undefined ? { useMarketPrice: h.useMarketPrice ?? true, ...(h.useMarketPrice !== false ? { price: px } : {}) } : { useMarketPrice: false });
    } else {
      const k = GLOBAL_TICKERS.find((x) => x.ticker === t);
      if (k) Object.assign(patch, { name: k.name, sector: k.sector });
    }
    set(patch);
  };

  const accountField = (
    <Field label="Account or owner" htmlFor="h-acc" hint="Use it to filter by person">
      <input id="h-acc" className="input" list="acc-list" value={h.account ?? ''} onChange={(e) => set({ account: e.target.value })} />
      <datalist id="acc-list">{accounts.map((a) => <option key={a} value={a} />)}</datalist>
    </Field>
  );
  const nameField = (label = 'Name', hint?: string) => (
    <Field label={label} htmlFor="h-name" hint={hint}>
      <input id="h-name" className="input" value={h.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
    </Field>
  );
  const dateField = (label = 'Purchase date', key: 'purchaseDate' | 'maturity' = 'purchaseDate', hint?: string) => (
    <Field label={label} htmlFor={'h-' + key} hint={hint}>
      <input id={'h-' + key} type="date" className="input" value={(h[key] as string) ?? ''} onChange={(e) => set({ [key]: e.target.value || undefined } as Partial<Holding>)} />
    </Field>
  );
  const quote = h.type === 'psx_stock' || h.type === 'psx_etf' ? psxQuote(psx, h.ticker) : undefined;
  const shariahHint = h.type === 'psx_stock'
    ? quote
      ? quote.sh ? `In the KMI All Share index (Shariah screened) on ${fmtDate(psx!.asOf)}` : `Not in the KMI All Share index on ${fmtDate(psx!.asOf)}`
      : 'Check the current KMI All Share list'
    : undefined;
  const shariahField = (
    <Field label="Shariah status" htmlFor="h-sh" hint={shariahHint}>
      <Select id="h-sh" value={(h.shariah ?? shariahOf(h)) as Shariah} onChange={(v) => set({ shariah: v })} options={[{ value: 'yes', label: 'Compliant' }, { value: 'no', label: 'Not compliant' }, { value: 'unknown', label: 'Not verified' }]} />
    </Field>
  );
  const qtyPrice = (qtyLabel: string, priceLabel: string, costLabel: string) => (
    <>
      <Field label={qtyLabel} htmlFor="h-qty">
        <NumberInput id="h-qty" value={h.qty} onChange={(v) => set({ qty: v ?? 0 })} min={0} decimals={6} />
      </Field>
      <Field label={priceLabel} htmlFor="h-price">
        <NumberInput id="h-price" value={h.price} onChange={(v) => set({ price: v ?? 0, priceSrc: undefined })} min={0} prefix={curSym} decimals={4} />
      </Field>
      <Field label={costLabel} htmlFor="h-cost" hint="Optional; used for gains and capital gains tax">
        <NumberInput id="h-cost" value={h.avgCost} onChange={(v) => set({ avgCost: v })} min={0} prefix={curSym} decimals={4} />
      </Field>
    </>
  );
  const amountFields = (amountLabel: string, costLabel?: string) => (
    <>
      <Field label={amountLabel} htmlFor="h-amt">
        <NumberInput id="h-amt" value={h.price} onChange={(v) => set({ price: v ?? 0, qty: 1 })} min={0} prefix={curSym} decimals={2} groupStyle={cur === 'PKR' ? 'lakh' : 'intl'} />
      </Field>
      {costLabel && (
        <Field label={costLabel} htmlFor="h-cost" hint="Optional">
          <NumberInput id="h-cost" value={h.avgCost} onChange={(v) => set({ avgCost: v })} min={0} prefix={curSym} decimals={2} groupStyle={cur === 'PKR' ? 'lakh' : 'intl'} />
        </Field>
      )}
    </>
  );
  const rateField = (label = 'Profit rate', hint?: string) => (
    <Field label={label} htmlFor="h-rate" hint={hint}>
      <NumberInput id="h-rate" value={h.rate} onChange={(v) => set({ rate: v })} suffix="% a year" decimals={3} placeholder={String(defaultRate(h, m))} />
    </Field>
  );

  let fields: React.ReactNode = null;
  switch (h.type) {
    case 'psx_stock':
    case 'psx_etf':
    case 'global_stock':
    case 'global_etf':
    case 'global_bond':
    case 'crypto': {
      const isPsx = h.type === 'psx_stock' || h.type === 'psx_etf';
      const live = isPsx && psx;
      fields = (
        <>
          {live ? (
            <PsxTicker h={h} psx={psx} quote={quote} onTicker={onTicker} onPick={(q) => pickPsx(q, psx)} set={set} />
          ) : (
            <Field label="Ticker" htmlFor="h-tk" hint={isPsx ? 'Pick from the list or type any PSX symbol' : 'Pick from the list or type any symbol'}>
              <input id="h-tk" className="input mono" list="tk-list" value={h.ticker ?? ''} onChange={(e) => onTicker(e.target.value)} />
              <datalist id="tk-list">{tickerList.map((t) => <option key={t.ticker} value={t.ticker}>{t.name}</option>)}</datalist>
            </Field>
          )}
          {nameField()}
          {!isPsx && h.type !== 'crypto' && (
            <Field label="Currency" htmlFor="h-cur">
              <Select id="h-cur" value={h.currency} onChange={(v) => set({ currency: v })} options={CUR_OPTS(['USD', 'GBP', 'EUR', 'AED', 'SAR'])} />
            </Field>
          )}
          {h.type === 'crypto' && (
            <Field label="Kind" htmlFor="h-ck">
              <Select id="h-ck" value={h.sub ?? 'alt'} onChange={(v) => set({ sub: v })} options={CRYPTO_KINDS.map((k) => ({ value: k.key, label: k.label }))} />
            </Field>
          )}
          {h.type === 'psx_stock' && (
            <Field label="Sector" htmlFor="h-sec">
              <Select id="h-sec" value={h.sector ?? 'Other'} onChange={(v) => set({ sector: v })} options={Object.keys(PSX_SECTORS).map((s) => ({ value: s, label: s }))} />
            </Field>
          )}
          {h.type === 'crypto' && cryptoUsd(m, h.ticker) !== undefined && (
            <div className="field full">
              <Toggle checked={!!h.useMarketPrice} onChange={(b) => set({ useMarketPrice: b, price: b ? cryptoUsd(m, h.ticker)! : h.price })}
                label={`Use the daily market price ($${cryptoUsd(m, h.ticker)!.toLocaleString('en-US', { maximumFractionDigits: 6 })} on ${fmtDate(m.cryptoDate ?? m.btcDate)})`} />
            </div>
          )}
          {qtyPrice(
            h.type === 'crypto' ? 'Coins' : h.unit === 'shares' ? 'Shares' : 'Units',
            h.type === 'crypto' && h.useMarketPrice ? 'Price (market)' : isPsx && h.priceSrc === 'psx' && h.autoPrice !== false ? 'Price (PSX, updates daily)' : 'Current price',
            'Average cost per unit',
          )}
          {dateField()}
          {(isPsx || h.type === 'global_stock' || h.type === 'global_etf') && (
            <Field label="Dividend yield" htmlFor="h-dy" hint="Optional; sector or fund default used if blank">
              <NumberInput id="h-dy" value={h.yieldPct} onChange={(v) => set({ yieldPct: v })} suffix="%" decimals={2} />
            </Field>
          )}
          {shariahField}
          {accountField}
        </>
      );
      break;
    }
    case 'mutual_fund':
    case 'vps': {
      const cats = h.type === 'vps' ? VPS_SCHEMES : FUND_CATEGORIES;
      const cat = fundCategory(h.type, h.sub);
      fields = (
        <>
          <FundPicker h={h} set={set} />
          {nameField('Fund name', 'For example the AMC and fund name')}
          <Field label={h.type === 'vps' ? 'Allocation scheme' : 'MUFAP category'} htmlFor="h-cat">
            <Select id="h-cat" value={h.sub ?? cats[0].key} onChange={(v) => set({ sub: v, ter: undefined, shariah: undefined })} options={cats.map((c) => ({ value: c.key, label: c.label }))} />
          </Field>
          {qtyPrice('Units', h.feedId ? 'NAV (updates daily)' : 'Current NAV', 'Average cost (NAV)')}
          {dateField()}
          <Field label="Expense ratio" htmlFor="h-ter" hint={`Default for this category: ${cat.ter}%`}>
            <NumberInput id="h-ter" value={h.ter} onChange={(v) => set({ ter: v })} suffix="% a year" decimals={2} placeholder={String(cat.ter)} />
          </Field>
          <Field label="Distributions" htmlFor="h-po">
            <Select id="h-po" value={(h.payout ?? 'none') as Payout} onChange={(v) => set({ payout: v })} options={[{ value: 'none', label: 'Growth (none paid)' }, { value: 'annual', label: 'Yearly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'monthly', label: 'Monthly' }]} />
          </Field>
          {h.payout && h.payout !== 'none' && (
            <Field label="Distribution yield" htmlFor="h-dy2"><NumberInput id="h-dy2" value={h.yieldPct} onChange={(v) => set({ yieldPct: v })} suffix="%" decimals={2} /></Field>
          )}
          {cat.fixed && rateField('Fixed return')}
          {cat.fixed && dateField('Maturity date', 'maturity')}
          {shariahField}
          {accountField}
        </>
      );
      break;
    }
    case 'nss': {
      fields = (
        <>
          <Field label="Product" htmlFor="h-nss">
            <Select id="h-nss" value={h.sub ?? 'RIC'} onChange={(v) => {
              const p = NSS_PRODUCTS.find((x) => x.key === v)!;
              set({ sub: v, name: p.label, rate: m.nss[v] ?? h.rate, shariah: undefined });
            }} options={NSS_PRODUCTS.map((p) => ({ value: p.key, label: p.label }))} />
          </Field>
          {nameField('Label')}
          {amountFields('Amount invested', undefined)}
          {rateField('Profit rate', `Current rate: ${m.nss[h.sub ?? 'RIC'] ?? '–'}% (from ${m.nssDate})`)}
          {dateField('Purchase date')}
          {dateField('Maturity date', 'maturity', 'Optional; worked out from the product term if blank')}
          {accountField}
        </>
      );
      break;
    }
    case 'govt_sec': {
      fields = (
        <>
          <Field label="Security" htmlFor="h-gs">
            <Select id="h-gs" value={h.sub ?? 'tbill'} onChange={(v) => set({ sub: v, name: GOVT_KINDS.find((g) => g.key === v)!.label })} options={GOVT_KINDS.map((g) => ({ value: g.key, label: g.label }))} />
          </Field>
          {nameField('Label')}
          {amountFields('Market value', 'Amount paid')}
          {rateField('Yield or coupon', `12-month T-bill cut-off: ${m.tbill.m12}% (${m.tbill.date})`)}
          {dateField('Maturity date', 'maturity')}
          {accountField}
        </>
      );
      break;
    }
    case 'deposit':
    case 'cash': {
      fields = (
        <>
          {h.type === 'deposit' && (
            <Field label="Account type" htmlFor="h-dk">
              <Select id="h-dk" value={h.sub ?? 'savings'} onChange={(v) => {
                const d = DEPOSIT_KINDS.find((x) => x.key === v)!;
                set({ sub: v, rate: d.rate, shariah: undefined });
              }} options={DEPOSIT_KINDS.map((d) => ({ value: d.key, label: d.label }))} />
            </Field>
          )}
          {nameField(h.type === 'deposit' ? 'Bank and account' : 'Label')}
          {amountFields('Balance')}
          {h.type === 'deposit' && rateField('Profit rate')}
          {accountField}
        </>
      );
      break;
    }
    case 'fx_cash': {
      fields = (
        <>
          <Field label="Kind" htmlFor="h-fk">
            <Select id="h-fk" value={h.sub ?? 'fcy_deposit'} onChange={(v) => {
              const k = FX_KINDS.find((x) => x.key === v)!;
              set({ sub: v, rate: v === 'npc' ? m.npcUsd : k.rate, shariah: undefined });
            }} options={FX_KINDS.map((k) => ({ value: k.key, label: k.label }))} />
          </Field>
          <Field label="Currency" htmlFor="h-fc">
            <Select id="h-fc" value={h.currency} onChange={(v) => set({ currency: v })} options={CUR_OPTS(['USD', 'AED', 'SAR', 'GBP', 'EUR'])} />
          </Field>
          {nameField('Label')}
          {amountFields(`Balance in ${h.currency}`)}
          {rateField('Profit rate')}
          {(h.sub === 'npc' || h.sub === 'npc_islamic') && dateField('Maturity date', 'maturity')}
          {accountField}
        </>
      );
      break;
    }
    case 'gold':
    case 'silver': {
      fields = (
        <>
          {nameField()}
          <Field label="Weight" htmlFor="h-w">
            <div className="input-group">
              <NumberInput id="h-w" value={h.qty} onChange={(v) => set({ qty: v ?? 0 })} min={0} decimals={3} />
              <select className="select" aria-label="Weight unit" style={{ width: 96, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }} value={h.unit ?? 'tola'} onChange={(e) => set({ unit: e.target.value })}>
                <option value="tola">tola</option>
                <option value="gram">gram</option>
                <option value="oz">troy oz</option>
              </select>
            </div>
          </Field>
          {h.type === 'gold' && (
            <Field label="Purity" htmlFor="h-k">
              <Select id="h-k" value={String(h.karat ?? 24) as '24' | '22' | '21' | '18'} onChange={(v) => set({ karat: Number(v) })} options={[{ value: '24', label: '24 karat' }, { value: '22', label: '22 karat' }, { value: '21', label: '21 karat' }, { value: '18', label: '18 karat' }]} />
            </Field>
          )}
          <div className="field full">
            <Toggle checked={!!h.useMarketPrice} onChange={(b) => set({ useMarketPrice: b, price: b ? (h.type === 'gold' ? m.goldTola : m.silverTola) : h.price })} label={`Use the market rate (${fmt.pkr(h.type === 'gold' ? m.goldTola : m.silverTola, false)} per tola of 24k on ${m.goldDate})`} />
          </div>
          {!h.useMarketPrice && (
            <Field label="Price per tola (24k)" htmlFor="h-gp"><NumberInput id="h-gp" value={h.price} onChange={(v) => set({ price: v ?? 0 })} prefix="Rs" groupStyle="lakh" /></Field>
          )}
          <Field label="Average cost per tola (24k basis)" htmlFor="h-gc" hint="Optional"><NumberInput id="h-gc" value={h.avgCost} onChange={(v) => set({ avgCost: v })} prefix="Rs" groupStyle="lakh" /></Field>
          {dateField()}
          {accountField}
        </>
      );
      break;
    }
    case 'property': {
      fields = (
        <>
          <Field label="Kind" htmlFor="h-pk">
            <Select id="h-pk" value={h.sub ?? 'apartment'} onChange={(v) => set({ sub: v })} options={PROPERTY_KINDS.map((k) => ({ value: k.key, label: k.label }))} />
          </Field>
          {nameField('Label', 'For example: Apartment, Clifton Block 5')}
          <Field label="City" htmlFor="h-city"><input id="h-city" className="input" value={h.city ?? ''} onChange={(e) => set({ city: e.target.value })} /></Field>
          <Field label="Area" htmlFor="h-area">
            <div className="input-group">
              <NumberInput id="h-area" value={h.area} onChange={(v) => set({ area: v })} decimals={2} />
              <select className="select" aria-label="Area unit" style={{ width: 100, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }} value={h.areaUnit ?? 'marla'} onChange={(e) => set({ areaUnit: e.target.value as Holding['areaUnit'] })}>
                <option value="marla">marla</option>
                <option value="kanal">kanal</option>
                <option value="sqft">sq ft</option>
                <option value="sqyd">sq yd</option>
              </select>
            </div>
          </Field>
          {amountFields('Market value today', 'Purchase price')}
          {dateField()}
          <Field label="FBR or DC value" htmlFor="h-fbr" hint="Optional; used for property taxes"><NumberInput id="h-fbr" value={h.fbrValue} onChange={(v) => set({ fbrValue: v })} prefix="Rs" groupStyle="lakh" /></Field>
          <Field label="Use" htmlFor="h-use">
            <Select id="h-use" value={h.propertyUse ?? 'self'} onChange={(v) => set({ propertyUse: v })} options={[{ value: 'self', label: 'Live in it' }, { value: 'rented', label: 'Rented out' }, { value: 'investment', label: 'Held for resale' }]} />
          </Field>
          {h.propertyUse === 'rented' && (
            <>
              <Field label="Monthly rent" htmlFor="h-rent"><NumberInput id="h-rent" value={h.rentMonthly} onChange={(v) => set({ rentMonthly: v })} prefix="Rs" groupStyle="lakh" /></Field>
              <Field label="Vacancy" htmlFor="h-vac" hint="Share of the year it sits empty"><NumberInput id="h-vac" value={h.vacancyPct} onChange={(v) => set({ vacancyPct: v })} suffix="%" decimals={1} /></Field>
            </>
          )}
          <Field label="Yearly costs" htmlFor="h-costs" hint="Maintenance, society charges, property tax"><NumberInput id="h-costs" value={h.costsAnnual} onChange={(v) => set({ costsAnnual: v })} prefix="Rs" groupStyle="lakh" /></Field>
          <Field label="Expected price growth" htmlFor="h-exp" hint="Optional; default follows the property assumption"><NumberInput id="h-exp" value={h.expReturn} onChange={(v) => set({ expReturn: v })} suffix="% a year" decimals={2} /></Field>
          {accountField}
        </>
      );
      break;
    }
    case 'retirement': {
      fields = (
        <>
          <Field label="Kind" htmlFor="h-rk"><Select id="h-rk" value={h.sub ?? 'provident'} onChange={(v) => set({ sub: v, name: RETIREMENT_KINDS.find((k) => k.key === v)!.label })} options={RETIREMENT_KINDS.map((k) => ({ value: k.key, label: k.label }))} /></Field>
          {nameField('Label')}
          {amountFields('Balance')}
          {rateField('Expected return', 'Leave blank to follow the PKR rate path')}
          {accountField}
        </>
      );
      break;
    }
    default: {
      fields = (
        <>
          {nameField()}
          <Field label="Currency" htmlFor="h-cc"><Select id="h-cc" value={h.currency} onChange={(v) => set({ currency: v })} options={CUR_OPTS(['PKR', 'USD', 'AED', 'SAR', 'GBP', 'EUR'])} /></Field>
          {amountFields('Value today', 'Amount invested')}
          <Field label="Expected return" htmlFor="h-er"><NumberInput id="h-er" value={h.expReturn} onChange={(v) => set({ expReturn: v })} suffix="% a year" decimals={2} /></Field>
          <Field label="Volatility" htmlFor="h-vol" hint="How much the value can swing in a year"><NumberInput id="h-vol" value={h.vol} onChange={(v) => set({ vol: v })} suffix="%" decimals={1} /></Field>
          <Field label="Cash yield" htmlFor="h-y"><NumberInput id="h-y" value={h.yieldPct} onChange={(v) => set({ yieldPct: v })} suffix="% a year" decimals={2} /></Field>
          <Field label="How quickly can you sell it?" htmlFor="h-liq">
            <Select id="h-liq" value={(h.liquidity ?? 'months') as Liquidity} onChange={(v) => set({ liquidity: v })} options={[{ value: 'days', label: 'Within a week' }, { value: 'weeks', label: 'Within a month' }, { value: 'months', label: '3 to 12 months' }, { value: 'locked', label: 'Locked' }]} />
          </Field>
          {accountField}
        </>
      );
    }
  }

  const showAdv = ['psx_stock', 'psx_etf', 'global_stock', 'global_etf', 'crypto', 'gold', 'property', 'mutual_fund', 'vps'].includes(h.type);
  return (
    <Modal
      key={'editor-' + h.type}
      wide
      title={<span className="row" style={{ gap: 8 }}><span className="swatch" style={{ background: 'var(--accent)' }} />{existing ? `Edit ${lowerLabel(meta.label)}` : `Add ${lowerLabel(meta.label)}`}</span>}
      onClose={closeEditor}
      footer={<>
        {existing && !confirmDelete && <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)} style={{ marginRight: 'auto' }}>Remove</Button>}
        {existing && confirmDelete && <span className="row" style={{ marginRight: 'auto' }}><span className="small">Remove this holding?</span><Button variant="danger" size="sm" onClick={del}>Yes, remove</Button><Button size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button></span>}
        {!existing && <Button variant="ghost" onClick={() => setH(null)}>Change type</Button>}
        <Button onClick={closeEditor}>Cancel</Button>
        <Button variant="primary" onClick={save}>{existing ? 'Save changes' : 'Add holding'}</Button>
      </>}
    >
      <div className="stack">
        <div className="form-grid">{fields}</div>
        {showAdv && (
          <div>
            <button type="button" className="linkbtn small" onClick={() => setShowAdvanced((s) => !s)} aria-expanded={showAdvanced}>{showAdvanced ? 'Hide' : 'Show'} risk and return overrides</button>
            {showAdvanced && (
              <div className="form-grid" style={{ marginTop: 10 }}>
                <Field label="Expected return override" htmlFor="h-ero" hint="Median yearly return in the holding's currency"><NumberInput id="h-ero" value={h.expReturn} onChange={(v) => set({ expReturn: v })} suffix="%" decimals={2} /></Field>
                <Field label="Volatility override" htmlFor="h-vo" hint="Total yearly volatility"><NumberInput id="h-vo" value={h.vol} onChange={(v) => set({ vol: v })} suffix="%" decimals={1} /></Field>
                {(h.type === 'psx_stock' || h.type === 'global_stock' || h.type === 'global_etf') && <Field label="Beta" htmlFor="h-beta" hint="Sensitivity to the market"><NumberInput id="h-beta" value={h.beta} onChange={(v) => set({ beta: v })} decimals={2} /></Field>}
                <Field label="Notes" htmlFor="h-notes" full><textarea id="h-notes" className="input" value={h.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} rows={2} /></Field>
              </div>
            )}
          </div>
        )}
        <div className="callout info">
          <span>
            Value today: <strong>{fmt.money(value, { compact: false })}</strong>
            {h.currency !== 'PKR' && <> ({fmt.pkr(value, true)} at Rs {m.fx[h.currency].toFixed(2)} per {h.currency})</>}
            {' · '}{CLASS_META[meta.cls].label}
          </span>
        </div>
        {error && <div className="callout warn" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

/** Link a fund holding to MUFAP's daily NAV list. */
function FundPicker({ h, set }: { h: Holding; set: (patch: Partial<Holding>) => void }) {
  const { funds, state } = useFeed();
  const [q, setQ] = useState('');
  const hits = useMemo(() => (funds ? searchFunds(funds.funds, q) : []), [funds, q]);
  if (!funds) {
    return state === 'loading' ? null : (
      <p className="mini-help full">Enter the NAV from your latest fund statement, or import the statement with AI from the Holdings screen.</p>
    );
  }
  const linked = h.feedId ? funds.funds.find((f) => f.id === h.feedId) : undefined;
  if (h.feedId) {
    return (
      <div className="field full">
        <div className="linked-fund">
          <div>
            <div className="strong">{linked ? fundLabel(linked) : h.name}</div>
            <div className="small ink2">
              {linked ? <>{linked.amc} · NAV {linked.nav.toLocaleString('en-US', { maximumFractionDigits: 4 })} on {fmtDate(linked.d)}{linked.r1y !== undefined ? ` · 1-year return ${linked.r1y > 0 ? '+' : ''}${linked.r1y}%` : ''} · updates daily from MUFAP</> : 'Linked to MUFAP; this fund is not in today’s list'}
            </div>
          </div>
          <Button size="sm" onClick={() => set({ feedId: undefined })}>Unlink</Button>
        </div>
      </div>
    );
  }
  const pick = (f: (typeof funds.funds)[number]) => {
    const c = categoryFromMufap(f.cat, f.sec);
    set({ feedId: f.id, type: c.type, sub: c.sub, name: fundLabel(f), price: f.nav, priceDate: f.d, shariah: c.shariah === 'yes' || f.sh ? 'yes' : undefined, ter: f.ter });
    setQ('');
  };
  return (
    <div className="field full">
      <label className="label" htmlFor="h-fund-q">Find the fund in MUFAP’s daily list</label>
      <input id="h-fund-q" className="input" placeholder="Fund or AMC name, e.g. Meezan Rozana" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {q.trim().length > 1 && (
        hits.length ? (
          <ul className="fund-hits">
            {hits.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => pick(f)}>
                  <span className="strong">{fundLabel(f)}</span>
                  <span className="small ink2">
                    {f.amc} · {f.cat} · NAV {f.nav.toLocaleString('en-US', { maximumFractionDigits: 4 })} on {fmtDate(f.d)}
                    {f.ter !== undefined && <> · expense ratio {f.ter}%</>}
                    {f.r1y !== undefined && <> · 1-year return {f.r1y > 0 ? '+' : ''}{f.r1y}%</>}
                    {f.stale ? <> · <span style={{ color: 'var(--warn-ink)' }}>stopped reporting</span></> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="mini-help">No fund matches “{q.trim()}” in {funds.count} funds dated {fmtDate(funds.asOf)}.</p>
      )}
      <p className="mini-help">Linking fills in the NAV and keeps it current. You can also type the details yourself.</p>
    </div>
  );
}

/** PSX ticker with search over the daily price list, and what the list says about the pick. */
function PsxTicker({ h, psx, quote, onTicker, onPick, set }: {
  h: Holding;
  psx: PsxDoc;
  quote: PsxQuote | undefined;
  onTicker: (raw: string) => void;
  onPick: (q: PsxQuote) => void;
  set: (patch: Partial<Holding>) => void;
}) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => (q.trim().length >= 1 ? searchPsx(psx, q, h.type === 'psx_etf' ? { etf: true } : {}) : []), [psx, q, h.type]);
  /** 'Rs 543.90, close on 22 Oct 2026', or 'Rs 543.90 at 14:15 on 22 Oct 2026' during trading. */
  const priceText = (x: PsxQuote) => {
    const rs = `Rs ${x.p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (x.d && x.d !== psx.asOf) return `${rs}, close on ${fmtDate(x.d)}`;
    return psx.intraday && psx.time ? `${rs} at ${psx.time} on ${fmtDate(psx.asOf)}` : `${rs}, close on ${fmtDate(psx.asOf)}`;
  };
  return (
    <>
      <Field label="Ticker" htmlFor="h-tk" hint="Type a PSX symbol">
        <input id="h-tk" className="input mono" value={h.ticker ?? ''} onChange={(e) => onTicker(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Or search by company" htmlFor="h-tk-q">
        <input id="h-tk-q" className="input" placeholder={h.type === 'psx_etf' ? 'e.g. Meezan Pakistan ETF' : 'e.g. Meezan Bank, cement'} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </Field>
      {q.trim().length >= 1 && (
        <div className="field full">
          {hits.length ? (
            <ul className="fund-hits">
              {hits.map((x) => (
                <li key={x.s}>
                  <button type="button" onClick={() => { onPick(x); setQ(''); }}>
                    <span className="strong"><span className="mono">{x.s}</span> · {companyName(x.n)}</span>
                    <span className="small ink2">{priceText(x)}{x.sec ? ` · ${x.sec}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="mini-help">Nothing on PSX matches “{q.trim()}”.</p>}
        </div>
      )}
      {quote && (
        <div className="field full">
          <div className="linked-fund">
            <div>
              <div className="strong">{companyName(quote.n)}{quote.x ? <span className="small ink2"> · trading as {quote.s}{quote.x}{SUFFIX_NOTE[quote.x] ? ` (${SUFFIX_NOTE[quote.x]})` : ''}</span> : null}</div>
              <div className="small ink2">
                PSX price {priceText(quote)}
                {quote.c !== undefined && <> ({quote.c > 0 ? '+' : ''}{quote.c}% on the day)</>}
                {quote.pe !== undefined && <> · P/E {quote.pe}</>}
                {quote.dy !== undefined && <> · dividend yield {quote.dy}%</>}
                {quote.k100 ? <> · in the KSE-100</> : null}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <Toggle
              checked={h.autoPrice !== false}
              onChange={(b) => set(b ? { autoPrice: undefined, price: quote.p, priceDate: quote.d ?? psx.asOf, priceSrc: 'psx' } : { autoPrice: false })}
              label="Update the price every trading day from PSX"
            />
          </div>
        </div>
      )}
      {!quote && (h.ticker ?? '').length >= 2 && (
        <p className="mini-help full">“{h.ticker}” is not in PSX’s list of {psx.count} symbols on {fmtDate(psx.asOf)}. Check the symbol, or enter the price yourself.</p>
      )}
    </>
  );
}
