import React, { useMemo, useState } from 'react';
import { SOURCES } from '../../engine/assumptions';
import { PROPERTY_KINDS } from '../../engine/catalog';
import { fmtDate, monthsBetween, todayISO } from '../../engine/format';
import {
  buyerAdvanceRate, cgtIfSoldToday, cgtRate, computeZakat, incomeTaxSummary, nisabPKR, sellerAdvanceRate, TAX, TAX_PERIOD, TAX_YEAR,
  ZAKAT_GROUPS, type ZakatGroup,
} from '../../engine/tax';
import type { Holding } from '../../engine/types';
import { annualIncomePKR, costPKR, filtersActive, grossRentPKR, valuePKR } from '../../engine/valuation';
import { useFilteredHoldings, useUI, useWS } from '../../state/store';
import { Badge, Button, Callout, Card, Field, KV, NumberInput, Seg, Select, Stat, Toggle } from '../components/primitives';
import { useFmt } from '../fmt';
import { ExampleBanner, PageHead, Sources } from './common';

// Shared so memos keyed on the liabilities list stay stable while filters are on.
const NO_LIABILITIES: never[] = [];

export function TaxZakat() {
  const { ws, active, update } = useWS();
  const { askAI, filters } = useUI();
  const holdings = useFilteredHoldings();
  const fmt = useFmt();
  const s = ws.settings;
  const m = ws.market;
  const today = todayISO();
  const setSettings = (p: Partial<typeof s>) => update((w) => ({ ...w, settings: { ...w.settings, ...p } }));

  const inc = useMemo(() => incomeTaxSummary(holdings, m, s.filer, (h) => annualIncomePKR(h, m), (h) => grossRentPKR(h, m)), [holdings, m, s.filer]);
  const incOther = useMemo(() => incomeTaxSummary(holdings, m, !s.filer, (h) => annualIncomePKR(h, m), (h) => grossRentPKR(h, m)), [holdings, m, s.filer]);
  const cgt = useMemo(() => cgtIfSoldToday(holdings, m, s.filer, today, s.foreignCgtRate), [holdings, m, s.filer, today, s.foreignCgtRate]);
  const cgtOther = useMemo(() => cgtIfSoldToday(holdings, m, !s.filer, today, s.foreignCgtRate), [holdings, m, s.filer, today, s.foreignCgtRate]);

  const [included, setIncluded] = useState<Partial<Record<ZakatGroup, boolean>>>({});
  const [deduct, setDeduct] = useState(true);
  const liabilities = filtersActive(filters) ? NO_LIABILITIES : active.liabilities;
  const zakat = useMemo(() => computeZakat(holdings, liabilities, m, s.nisabBasis, included, deduct), [holdings, liabilities, m, s.nisabBasis, included, deduct]);
  const nisabSilver = nisabPKR(m, 'silver');
  const nisabGold = nisabPKR(m, 'gold');

  const explain = () => askAI(
    `Help me understand my tax and zakat position under ${TAX_YEAR} rules and suggest legal ways to reduce tax leakage. I am a ${s.filer ? 'filer on the Active Taxpayers List' : 'non-filer'}. Yearly tax on portfolio income: ${fmt.money(inc.total)} on ${fmt.money(inc.gross)} of income (${inc.lines.map((l) => `${l.label} ${fmt.money(l.tax)}`).join(', ')}). As the other status it would be ${fmt.money(incOther.total)}. CGT if I sold everything today: ${fmt.money(cgt.total)} on ${fmt.money(cgt.gains)} of gains. Zakat due on the ${s.nisabBasis} nisab: ${fmt.money(zakat.due)} on a zakatable base of ${fmt.money(zakat.base)}. Call get_tax_rates if you need the rate table.`,
    true,
    'Explain my tax and zakat',
  );

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Tax and zakat"
        sub={`Estimates under ${TAX_YEAR} rules (${TAX_PERIOD}), Finance Act 2026. Confirm with a tax adviser before acting.`}
        actions={<>
          <Seg label="Tax status" value={s.filer ? 'filer' : 'nonfiler'} onChange={(v) => setSettings({ filer: v === 'filer' })} options={[{ value: 'filer', label: 'Filer (ATL)' }, { value: 'nonfiler', label: 'Non-filer' }]} />
          <Button variant="ai" icon="sparkle" onClick={explain}>Explain with AI</Button>
        </>}
      />
      <ExampleBanner />
      <div className="stats">
        <Stat label="Tax on income this year" value={fmt.money(inc.total)} note={`${inc.gross > 0 ? fmt.pct((inc.total / inc.gross) * 100, 1) : '0%'} of ${fmt.money(inc.gross)}`} />
        <Stat label={s.filer ? 'Saved by being a filer' : 'Extra paid as a non-filer'} value={fmt.money(Math.abs(incOther.total - inc.total))} note={`a year on income tax; ${fmt.money(Math.abs(cgtOther.total - cgt.total))} on CGT if sold today`} />
        <Stat label="CGT if sold today" value={fmt.money(cgt.total)} note={`on ${fmt.money(cgt.gains)} of gains`} />
        <Stat label="Zakat due" value={fmt.money(zakat.due)} note={zakat.aboveNisab ? `2.5% of ${fmt.money(zakat.base)}` : 'below nisab'} />
      </div>

      <div className="grid">
        <Card className="span-6" flush title="Yearly tax on portfolio income" sub="Withholding at source on dividends, profit and rent">
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Income</th><th className="num">Rate</th><th className="num">Gross</th><th className="num">Tax</th></tr></thead>
              <tbody>
                {inc.lines.map((l) => <tr key={l.key}><td>{l.label}</td><td className="num small">{l.rateNote}</td><td className="num">{fmt.money(l.gross)}</td><td className="num strong">{fmt.money(l.tax)}</td></tr>)}
                {!inc.lines.length && <tr><td colSpan={4} className="muted small">No taxable income in this view.</td></tr>}
                <tr className="total"><td colSpan={2}>Total</td><td className="num">{fmt.money(inc.gross)}</td><td className="num">{fmt.money(inc.total)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card-b">
            <p className="mini-help">As a {s.filer ? 'non-filer' : 'filer'} the same income would be taxed {fmt.money(incOther.total)}. Withholding on most portfolio income is a final tax for individuals; rent is taxed by slab and US dividends lose 30% at source.</p>
          </div>
        </Card>

        <Card className="span-6" flush title="Capital gains tax if sold today" sub="By holding, using purchase dates and the regime that applies">
          <div className="table-wrap">
            <table className="t compact">
              <thead><tr><th>Holding</th><th className="num">Gain</th><th className="num">Rate</th><th className="num">Tax</th></tr></thead>
              <tbody>
                {cgt.lines.map((l) => <tr key={l.id}><td><span className="cell-name"><span className="n1">{l.name}</span></span></td><td className={'num ' + (l.gain >= 0 ? 'up' : 'down')}>{fmt.money(l.gain, { sign: true })}</td><td className="num">{fmt.pct(l.rate * 100, 1)}</td><td className="num strong">{l.tax > 0 ? fmt.money(l.tax) : '–'}</td></tr>)}
                {!cgt.lines.length && <tr><td colSpan={4} className="muted small">Add purchase costs to holdings to estimate capital gains tax.</td></tr>}
                <tr className="total"><td>Total</td><td className="num">{fmt.money(cgt.gains, { sign: true })}</td><td /><td className="num">{fmt.money(cgt.total)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card-b">
            <p className="mini-help">Shares and fund units bought from 1 July 2024 pay a flat 15% as a filer. Older purchases follow the earlier holding-period rates, falling to zero after enough years. Property bought before July 2024 also tapers to zero with time. Foreign gains use your setting of {s.foreignCgtRate}% (Settings).</p>
          </div>
        </Card>

        <PropertyDeal holdings={holdings} />

        <Card className="span-6" title="Zakat calculator" sub="2.5% of zakatable wealth held for a lunar year, if it is above nisab">
          <div className="stack">
            <div className="row-between">
              <Seg label="Nisab basis" value={s.nisabBasis} onChange={(v) => setSettings({ nisabBasis: v })} options={[{ value: 'silver', label: `Silver (${TAX.nisabSilverTola} tola)` }, { value: 'gold', label: `Gold (${TAX.nisabGoldTola} tola)` }]} />
              <span className="small muted">Nisab {fmt.money(s.nisabBasis === 'silver' ? nisabSilver : nisabGold)}</span>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {zakat.byGroup.filter((g) => g.value > 0).map((g) => {
                const meta = ZAKAT_GROUPS.find((z) => z.key === g.key)!;
                return (
                  <div key={g.key} className="row-between" style={{ alignItems: 'flex-start' }}>
                    <Toggle checked={g.included} onChange={(b) => setIncluded((x) => ({ ...x, [g.key]: b }))} label={<span><span className="strong" style={{ color: 'var(--ink)' }}>{g.label}</span><span className="tiny muted" style={{ display: 'block' }}>{meta.note}</span></span>} />
                    <span className={'num small ' + (g.included ? 'strong' : 'muted')}>{fmt.money(g.value)}</span>
                  </div>
                );
              })}
              {zakat.byGroup.every((g) => g.value <= 0) && <p className="small muted">No zakatable assets in this view.</p>}
            </div>
            {liabilities.length > 0 && <Toggle checked={deduct} onChange={setDeduct} label="Deduct debts due within 12 months" />}
            <div className="divider" />
            <KV rows={[
              ['Zakatable assets', fmt.money(zakat.gross)],
              ...(zakat.deductions > 0 ? [['Less debts due within a year', `−${fmt.money(zakat.deductions)}`] as [string, string]] : []),
              ['Zakatable base', fmt.money(zakat.base)],
              ['Nisab', `${fmt.money(zakat.nisab)} ${zakat.aboveNisab ? '(above)' : '(below)'}`],
              [<strong key="z">Zakat due</strong>, <strong key="zv" style={{ fontSize: 16 }}>{fmt.money(zakat.due)}</strong>],
            ]} />
            <p className="mini-help">Your home and rented property are not zakatable; property held for resale is. Banks deduct zakat on savings accounts on the first of Ramadan unless you have filed a declaration (CZ-50), so count any amount already deducted. Scholars differ on shares and pension funds; ask yours if unsure.</p>
          </div>
        </Card>
      </div>
      <Sources items={[SOURCES.tax, SOURCES.cgt, SOURCES.property].map((x) => ({ label: x.label, url: x.url, asOf: x.asOf }))} />
    </div>
  );
}

function PropertyDeal({ holdings }: { holdings: Holding[] }) {
  const { ws } = useWS();
  const fmt = useFmt();
  const m = ws.market;
  const today = todayISO();
  const props = holdings.filter((h) => h.type === 'property');
  const [pick, setPick] = useState<string>(props[0]?.id ?? '');
  const chosen = props.find((p) => p.id === pick);
  const [price, setPrice] = useState<number>(chosen ? valuePKR(chosen, m) : 20_000_000);
  const [fbr, setFbr] = useState<number | undefined>(chosen?.fbrValue);
  const [cost, setCost] = useState<number>(chosen ? costPKR(chosen, m) ?? 0 : 12_000_000);
  const [bought, setBought] = useState<string>(chosen?.purchaseDate ?? '2022-01-01');
  const [kind, setKind] = useState<string>(chosen?.sub ?? 'residential_plot');
  const [sellerFiler, setSellerFiler] = useState(ws.settings.filer);
  const [buyerFiler, setBuyerFiler] = useState(true);

  const load = (id: string) => {
    setPick(id);
    const h = props.find((p) => p.id === id);
    if (!h) return;
    setPrice(Math.round(valuePKR(h, m)));
    setFbr(h.fbrValue);
    setCost(Math.round(costPKR(h, m) ?? 0));
    if (h.purchaseDate) setBought(h.purchaseDate);
    if (h.sub) setKind(h.sub);
  };

  const fmv = Math.max(price, fbr ?? 0);
  const seller = fmv * sellerAdvanceRate(sellerFiler);
  const buyer = fmv * buyerAdvanceRate(fmv, buyerFiler);
  const gain = price - cost;
  const rate = cgtRate({ id: 'x', type: 'property', name: 'x', currency: 'PKR', qty: 1, price, purchaseDate: bought, sub: kind }, sellerFiler, today, ws.settings.foreignCgtRate);
  const cgt = Math.max(0, gain) * rate;
  const years = monthsBetween(bought, today) / 12;

  return (
    <Card className="span-6" title="Property deal calculator" sub="Advance tax at registration (236C for the seller, 236K for the buyer) and CGT on the gain">
      <div className="stack">
        {props.length > 0 && (
          <Field label="Start from a property you own" htmlFor="pd-pick">
            <Select id="pd-pick" value={pick} onChange={load} options={[{ value: '', label: 'Enter figures by hand' }, ...props.map((p) => ({ value: p.id, label: p.name }))]} />
          </Field>
        )}
        <div className="form-grid">
          <Field label="Sale price" htmlFor="pd-price"><NumberInput id="pd-price" value={price} onChange={(v) => setPrice(Math.max(0, v ?? 0))} prefix="Rs" groupStyle="lakh" step={100000} /></Field>
          <Field label="FBR valuation (if higher)" htmlFor="pd-fbr" hint="Advance tax uses the higher of the two"><NumberInput id="pd-fbr" value={fbr} onChange={(v) => setFbr(v)} prefix="Rs" groupStyle="lakh" placeholder="optional" /></Field>
          <Field label="Your purchase cost" htmlFor="pd-cost"><NumberInput id="pd-cost" value={cost} onChange={(v) => setCost(Math.max(0, v ?? 0))} prefix="Rs" groupStyle="lakh" step={100000} /></Field>
          <Field label="Bought on" htmlFor="pd-date" hint={`${years.toFixed(1)} years held`}><input id="pd-date" type="date" className="input" value={bought} max={today} onChange={(e) => setBought(e.target.value)} /></Field>
          <Field label="Property type" htmlFor="pd-kind"><Select id="pd-kind" value={kind} onChange={setKind} options={PROPERTY_KINDS.map((k) => ({ value: k.key, label: k.label }))} /></Field>
          <div className="field"><span className="label" style={{ fontSize: 12.5, fontWeight: 550, color: 'var(--ink-2)' }}>Tax status</span>
            <div className="stack" style={{ gap: 6 }}>
              <Toggle checked={sellerFiler} onChange={setSellerFiler} label="Seller is a filer" />
              <Toggle checked={buyerFiler} onChange={setBuyerFiler} label="Buyer is a filer" />
            </div>
          </div>
        </div>
        <div className="divider" />
        <KV rows={[
          [`Seller advance tax, 236C (${fmt.pct(sellerAdvanceRate(sellerFiler) * 100, 2)})`, fmt.pkr(seller, false)],
          [`Buyer advance tax, 236K (${fmt.pct(buyerAdvanceRate(fmv, buyerFiler) * 100, 2)})`, fmt.pkr(buyer, false)],
          ['Capital gain', fmt.pkr(gain, false)],
          [`CGT on the gain (${fmt.pct(rate * 100, 1)})`, fmt.pkr(cgt, false)],
          [<strong key="n">Seller keeps after tax</strong>, <strong key="nv">{fmt.pkr(price - Math.max(seller, cgt), false)}</strong>],
        ]} />
        <div className="row" style={{ gap: 6 }}>
          <Badge>{bought >= '2024-07-01' ? 'Bought from July 2024: flat rate' : 'Bought before July 2024: rate tapers with years held'}</Badge>
        </div>
        <p className="mini-help">The seller’s 236C advance tax is generally adjustable against the CGT due on the sale, so the seller’s total is usually the larger of the two. Provincial stamp duty, CVT and registration fees are extra. Holding dates follow {fmtDate(today)} as the sale date.</p>
        {!sellerFiler && <Callout tone="warn">Non-filer sellers pay {fmt.pct(TAX.sellerAdvanceNonFiler * 100, 1)} advance tax instead of {fmt.pct(TAX.sellerAdvance * 100, 2)}: about {fmt.pkr(fmv * (TAX.sellerAdvanceNonFiler - TAX.sellerAdvance))} more on this deal.</Callout>}
      </div>
    </Card>
  );
}
