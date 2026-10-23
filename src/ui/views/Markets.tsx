import React, { useMemo, useState } from 'react';
import { DEFAULT_ASSUMPTIONS, DEFAULT_MARKET, expectedFxChange, FACTOR_LABELS, FACTOR_SHORT, SOURCES } from '../../engine/assumptions';
import { optClassOf } from '../../engine/exposures';
import { fmtDate, todayISO } from '../../engine/format';
import { backtest, HISTORY_LAST, KSE100, USDPKR, type BacktestWeights } from '../../engine/history';
import { safeCholesky } from '../../engine/linalg';
import type { Assumptions, FactorKey, MacroAssumptions, MarketSnapshot } from '../../engine/types';
import { ASSET_FACTORS, FACTOR_ORDER } from '../../engine/types';
import { valuePKR } from '../../engine/valuation';
import { applyFeed, type FeedDoc, type FundsDoc, type PsxDoc } from '../../engine/feed';
import { useFeed, useUI, useWS } from '../../state/store';
import { ChartFrame, LegendItem, useColors } from '../charts/base';
import { CorrelationHeatmap, MultiLineChart } from '../charts/charts';
import { Badge, Button, Callout, Card, Field, KV, Modal, NumberInput, Pill, Seg, Stat } from '../components/primitives';
import { useFmt } from '../fmt';
import { PageHead, Sources } from './common';

const FACTOR_CCY: Record<FactorKey, string> = { psx: 'PKR', gleq: 'USD', glbond: 'USD', gold: 'USD', re: 'PKR', crypto: 'USD' };
const MACRO_FIELDS: { key: keyof MacroAssumptions; label: string; unit: string; hint?: string }[] = [
  { key: 'rate0', label: 'PKR short rate today', unit: '%' },
  { key: 'rateLR', label: 'Short rate, long run', unit: '%' },
  { key: 'rateVol', label: 'Short rate volatility', unit: 'pts/yr' },
  { key: 'cpi0', label: 'Inflation today', unit: '%' },
  { key: 'cpiLR', label: 'Inflation, long run', unit: '%' },
  { key: 'cpiVol', label: 'Inflation volatility', unit: 'pts/yr' },
  { key: 'fxDrift', label: 'USD/PKR steady drift', unit: '%/yr' },
  { key: 'fxVol', label: 'USD/PKR volatility', unit: '%' },
  { key: 'jumpProb', label: 'Chance of a devaluation, yearly', unit: '%' },
  { key: 'jumpSize', label: 'Size of a devaluation', unit: '%' },
  { key: 'jumpPsx', label: 'PSX move in a devaluation month', unit: '%' },
  { key: 'usInflation', label: 'US inflation', unit: '%' },
  { key: 'usdRate', label: 'USD cash rate', unit: '%' },
];

type Range = '2006' | '2010' | '2015' | '2020';
const fmtIdx = (v: number) => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}K` : v.toFixed(0));

export function Markets() {
  const { ws, active, update } = useWS();
  const { askAI, toast } = useUI();
  const feedCtx = useFeed();
  const fmt = useFmt();
  const colors = useColors();
  const m = ws.market;
  const locked = m.locked ?? [];
  const a = ws.assumptions;
  const [editMarket, setEditMarket] = useState(false);
  const [editCorr, setEditCorr] = useState(false);
  const [range, setRange] = useState<Range>('2010');
  const setA = (fn: (x: Assumptions) => Assumptions) => update((w) => ({ ...w, assumptions: { ...fn(w.assumptions), asOf: todayISO() } }));
  const repaired = useMemo(() => safeCholesky(a.corr).repaired, [a.corr]);
  const edited = JSON.stringify(a.factors) !== JSON.stringify(DEFAULT_ASSUMPTIONS.factors) || JSON.stringify(a.macro) !== JSON.stringify(DEFAULT_ASSUMPTIONS.macro) || JSON.stringify(a.corr) !== JSON.stringify(DEFAULT_ASSUMPTIONS.corr);
  const switchToDaily = () => {
    update((w) => {
      const base = { ...w.market, locked: [] as string[], feedAt: undefined };
      return { ...w, market: feedCtx.feed ? applyFeed(base, feedCtx.feed) : JSON.parse(JSON.stringify(DEFAULT_MARKET)) };
    });
    toast(feedCtx.feed ? 'Using the daily data again' : 'Market data reset to the built-in snapshot');
  };

  const weights = useMemo(() => {
    const w: BacktestWeights = {};
    for (const h of active.holdings) {
      const v = valuePKR(h, m);
      const k = h.type === 'property' ? 'realestate' : optClassOf(h) ?? 'other';
      w[k] = (w[k] ?? 0) + v;
    }
    return w;
  }, [active.holdings, m]);
  const bt = useMemo(() => backtest(Object.keys(weights).length ? weights : { pkfi: 1 }, Number(range)), [weights, range]);
  const hist = useMemo(() => {
    const start = Number(range);
    const idx = (arr: number[]) => arr.map((v) => Math.round(v * 10) / 10);
    const fx = bt.years.map((y) => (USDPKR[y] / USDPKR[start]) * 100);
    return {
      labels: bt.years.map(String),
      series: [
        { name: 'Your mix (backtest)', data: idx(bt.portfolio), color: colors.ink, width: 2.5 },
        { name: 'KSE-100 in PKR', data: idx(bt.kse), color: colors.series[0] },
        { name: 'KSE-100 in USD', data: idx(bt.kseUsd), color: colors.series[5] },
        { name: 'T-bills', data: idx(bt.cash), color: colors.series[2] },
        { name: 'USD/PKR', data: idx(fx), color: colors.series[1] },
        { name: 'Prices (CPI)', data: idx(bt.cpi), color: colors.series[7] },
      ],
    };
  }, [bt, range, colors]);

  const kseFed = !locked.includes('kse100') && !!m.psxIndices?.rows.KSE100;
  const ytd = `${m.kse100Ytd > 0 ? '+' : ''}${m.kse100Ytd}% this year`;
  const kseNote = kseFed
    ? `${m.psxIndices?.intraday && m.psxIndices.time ? `${m.psxIndices.time}, ${fmtDate(m.kse100Date)}, during trading` : `close, ${fmtDate(m.kse100Date)}`} · ${ytd} · record ${m.kse100Ath.toLocaleString('en-US')}`
    : `${fmtDate(m.kse100Date)} · ${ytd} · ${locked.includes('kse100') ? 'entered by hand' : 'snapshot'}`;
  const tiles: { label: string; value: string; note: string }[] = [
    { label: 'KSE-100', value: m.kse100.toLocaleString('en-US', { maximumFractionDigits: 0 }), note: kseNote },
    { label: 'SBP policy rate', value: `${m.policyRate}%`, note: `since ${fmtDate(m.policyDate)}` },
    { label: 'Inflation (CPI)', value: `${m.cpi}%`, note: `${m.cpiMonth}, year on year · core ${m.coreCpi}%` },
    { label: '12-month T-bill', value: pct2(m.tbill.m12), note: `cut-off ${fmtDate(m.tbill.date)} · 3M ${pct2(m.tbill.m3)}` },
    { label: 'USD/PKR', value: m.fx.USD.toFixed(2), note: `interbank, ${fmtDate(m.fxDate)}` },
    { label: 'Gold, 24k', value: `Rs ${m.goldTola.toLocaleString('en-US')}`, note: `per tola · $${m.goldUsdOz.toLocaleString('en-US')}/oz · ${fmtDate(m.goldDate)}` },
    { label: 'Silver', value: `Rs ${m.silverTola.toLocaleString('en-US')}`, note: `per tola · ${fmtDate(m.goldDate)}` },
    { label: 'Bitcoin', value: `$${m.btcUsd.toLocaleString('en-US')}`, note: fmtDate(m.btcDate) },
    { label: 'S&P 500', value: m.sp500.toLocaleString('en-US'), note: `${fmtDate(m.sp500Date)} · ${m.sp500Ytd > 0 ? '+' : ''}${m.sp500Ytd}% this year · entered by hand` },
    { label: 'US rates', value: `${m.fedFunds}%`, note: `Fed funds · 10-year Treasury ${m.ust10y}%` },
  ];
  if (m.kibor?.m6) tiles.splice(4, 0, { label: '6-month KIBOR', value: pct2(m.kibor.m6), note: `offer, ${fmtDate(m.kibor.date)} · 3M ${pct2(m.kibor.m3)}` });
  if (m.reserves?.total) tiles.push({ label: 'FX reserves', value: `$${(m.reserves.total / 1000).toFixed(1)} bn`, note: `total liquid, ${fmtDate(m.reserves.date)} · SBP $${((m.reserves.sbp ?? 0) / 1000).toFixed(1)} bn` });

  const explain = () => askAI(
    `Sanity-check the forecasting assumptions in this app against today's market data and history, and tell me which ones look optimistic or pessimistic for a Pakistani investor. Then explain what the backtest of my current mix since ${range} shows: CAGR ${(bt.cagr * 100).toFixed(1)}% in PKR, ${(bt.realCagr * 100).toFixed(1)}% after inflation, worst year ${bt.worst.year} at ${(bt.worst.ret * 100).toFixed(1)}%, best ${bt.best.year} at ${(bt.best.ret * 100).toFixed(1)}%, KSE-100 ${(bt.kseCagr * 100).toFixed(1)}% a year.`,
    true,
    'Check the assumptions',
  );

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Markets and assumptions"
        sub={m.feedAt
          ? `The dated market data that values your holdings, and the assumptions that drive every forecast. Updated ${fmtStamp(m.feedAt)} from official sources.`
          : `The dated market data that values your holdings, and the assumptions that drive every forecast. Snapshot as of ${fmtDate(m.asOf)}.`}
        actions={<>
          <Button icon="edit" onClick={() => setEditMarket(true)}>Edit market data</Button>
          <Button variant="ai" icon="sparkle" onClick={explain}>Check with AI</Button>
        </>}
      />
      {locked.length > 0 && (
        <Callout>
          You entered {locked.length === 1 ? 'one figure' : `${locked.length} figures`} yourself ({locked.map((k) => LOCK_LABELS[k] ?? k).join(', ')}), so daily updates leave {locked.length === 1 ? 'it' : 'them'} alone.{' '}
          <button type="button" className="linkbtn" onClick={switchToDaily}>{feedCtx.feed ? 'Use the daily data again' : 'Reset to the snapshot'}</button>
        </Callout>
      )}
      <DailyData m={m} feed={feedCtx.feed} funds={feedCtx.funds} psx={feedCtx.psx} state={feedCtx.state} autoOff={ws.settings.autoData === false} />
      <div className="stats">
        {tiles.map((t) => <Stat key={t.label} label={t.label} value={t.value} note={t.note} />)}
      </div>
      <div className="grid">
        <Card className="span-6" title="Exchange rates" sub={`Rupees per unit · interbank ${fmtDate(m.fxDate)}${m.fxOpen ? ` · open market ${fmtDate(m.fxOpenDate)}` : ''}`}>
          {m.fxOpen ? (
            <div className="table-wrap">
              <table className="t compact">
                <thead><tr><th>Currency</th><th className="num">Interbank</th><th className="num">Open market, buy</th><th className="num">Open market, sell</th></tr></thead>
                <tbody>
                  {(['USD', 'AED', 'SAR', 'GBP', 'EUR'] as const).map((c) => (
                    <tr key={c}><td className="strong">{c}</td><td className="num">{m.fx[c].toFixed(2)}</td><td className="num">{m.fxOpen?.[c]?.buy.toFixed(2) ?? '–'}</td><td className="num">{m.fxOpen?.[c]?.sell.toFixed(2) ?? '–'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <KV rows={(['USD', 'AED', 'SAR', 'GBP', 'EUR'] as const).map((c) => [c, `Rs ${m.fx[c].toFixed(2)}`])} />
          )}
          <p className="mini-help" style={{ marginTop: 10 }}>{m.feedAt ? 'USD is SBP’s interbank rate; other currencies are cross rates through the dollar. Open-market rates are what exchange companies quoted at the close.' : 'AED and SAR are pegged to the dollar; GBP and EUR are approximate cross rates.'}</p>
        </Card>
        <Card className="span-6" title="National Savings rates" sub={`Profit rates from ${fmtDate(m.nssDate)}`}>
          <KV rows={[
            ['Behbood Savings and Pensioners’ Benefit', pct2(m.nss.BSC)],
            ['Special Savings Certificates', pct2(m.nss.SSC)],
            ['Defence Savings Certificates', pct2(m.nss.DSC)],
            ['Regular Income Certificates', pct2(m.nss.RIC)],
            ['Short Term Savings Certificates, 1 year', pct2(m.nss.STSC)],
            ['Sarwa Islamic Term, 3 and 5 years', `${pct2(m.nss.SITA3)} · ${pct2(m.nss.SITA5)}`],
            ['Sarwa Islamic Savings Account', pct2(m.nss.SISA)],
            ['USD Naya Pakistan Certificate', pct2(m.npcUsd)],
          ]} />
        </Card>
        <Card className="span-6" title="Interest rates" sub="Pakistan and US, % a year">
          <KV rows={[
            ['SBP policy rate', `${m.policyRate}% since ${fmtDate(m.policyDate)}`],
            ...(m.kibor?.m3 ? [['KIBOR offer, 3 / 6 / 12 months', `${pct2(m.kibor.m3)} · ${pct2(m.kibor.m6)} · ${pct2(m.kibor.m12)}`] as [string, string]] : []),
            ['T-bill cut-offs, 1 / 3 / 6 / 12 months', `${pct2(m.tbill.m1)} · ${pct2(m.tbill.m3)} · ${pct2(m.tbill.m6)} · ${pct2(m.tbill.m12)}`],
            ['US fed funds (effective)', pct2(m.fedFunds)],
            ['US Treasury, 2 / 10 years', `${pct2(m.ust2y)} · ${pct2(m.ust10y)}`],
          ]} />
          <p className="mini-help" style={{ marginTop: 10 }}>T-bill yields are from the auction of {fmtDate(m.tbill.date)}{m.kibor?.date ? `; KIBOR from ${fmtDate(m.kibor.date)}` : ''}{m.usDate ? `; US yields from ${fmtDate(m.usDate)}` : ''}.</p>
        </Card>
        {m.psxIndices && Object.keys(m.psxIndices.rows).length > 0 && (
          <PsxIndices ix={m.psxIndices} breadth={feedCtx.feed?.extra?.psx?.breadth} count={feedCtx.psx?.count} />
        )}
        {m.crypto && (
          <Card className="span-6" title="Crypto prices" sub={`Daily close, ${fmtDate(m.cryptoDate)}`}>
            <div className="table-wrap">
              <table className="t compact">
                <thead><tr><th>Coin</th><th className="num">USD</th><th className="num">PKR</th></tr></thead>
                <tbody>
                  {CRYPTO_SHOWN.filter((c) => m.crypto?.[c] !== undefined).map((c) => (
                    <tr key={c}><td className="strong mono">{c}</td><td className="num">{fmtCoin(m.crypto![c])}</td><td className="num">{fmtCoin(m.crypto![c] * m.fx.USD)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mini-help" style={{ marginTop: 10 }}>Crypto holdings set to “use the daily market price” are valued at these prices.</p>
          </Card>
        )}
      </div>

      <Card title="Forecast assumptions" sub={`Median yearly return and volatility of each market, and Pakistan’s macro path${edited ? ` · edited ${fmtDate(a.asOf)}` : ' · defaults'}`}
        actions={<Button size="sm" icon="refresh" disabled={!edited} onClick={() => { update((w) => ({ ...w, assumptions: JSON.parse(JSON.stringify(DEFAULT_ASSUMPTIONS)) })); toast('Assumptions reset to defaults'); }}>Reset to defaults</Button>}>
        <div className="grid">
          <div className="span-6 stack">
            <div className="table-wrap">
              <table className="t compact">
                <thead><tr><th>Market</th><th>In</th><th className="num">Median return / yr</th><th className="num">Volatility</th></tr></thead>
                <tbody>
                  {ASSET_FACTORS.map((k) => (
                    <tr key={k}>
                      <td>{FACTOR_LABELS[k]}</td>
                      <td className="small muted">{FACTOR_CCY[k]}</td>
                      <td className="num" style={{ width: 130 }}><NumberInput ariaLabel={`${FACTOR_LABELS[k]} median return`} value={a.factors[k].cagr} min={-20} max={60} step={0.5} suffix="%" onChange={(v) => setA((x) => ({ ...x, factors: { ...x.factors, [k]: { ...x.factors[k], cagr: v ?? 0 } } }))} /></td>
                      <td className="num" style={{ width: 120 }}><NumberInput ariaLabel={`${FACTOR_LABELS[k]} volatility`} value={a.factors[k].vol} min={0} max={150} step={1} suffix="%" onChange={(v) => setA((x) => ({ ...x, factors: { ...x.factors, [k]: { ...x.factors[k], vol: Math.max(0, v ?? 0) } } }))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mini-help">Medians are compound growth rates: half of simulated years-on-average land above, half below. USD markets also move with USD/PKR when shown in rupees. Property excludes rent, which is modelled from each holding.</p>
          </div>
          <div className="span-6 stack">
            <div className="form-grid">
              {MACRO_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} htmlFor={`mac-${f.key}`}>
                  <NumberInput id={`mac-${f.key}`} value={a.macro[f.key]} step={0.25} suffix={f.unit} onChange={(v) => setA((x) => ({ ...x, macro: { ...x.macro, [f.key]: v ?? 0 } }))} />
                </Field>
              ))}
            </div>
            <Callout>These settings imply USD/PKR rises about <strong>{expectedFxChange(a).toFixed(1)}% a year</strong> on average, including devaluation jumps. It rose about 8% a year from 2005 to 2025.</Callout>
          </div>
        </div>
      </Card>

      <Card className="chart-card" title="How markets move together" sub="Correlation of monthly shocks used by the simulation"
        actions={<Button size="sm" icon="edit" onClick={() => setEditCorr((e) => !e)} aria-pressed={editCorr}>{editCorr ? 'Done editing' : 'Edit correlations'}</Button>}>
        {repaired && <Callout tone="warn">These correlations are not internally consistent, so the simulation uses the nearest valid matrix. Small adjustments usually fix this.</Callout>}
        {editCorr ? (
          <div className="table-wrap">
            <table className="t compact">
              <thead><tr><th></th>{FACTOR_ORDER.map((k) => <th key={k} className="num">{FACTOR_SHORT[k]}</th>)}</tr></thead>
              <tbody>
                {FACTOR_ORDER.map((ri, i) => (
                  <tr key={ri}>
                    <td className="strong small">{FACTOR_SHORT[ri]}</td>
                    {FACTOR_ORDER.map((cj, j) => (
                      <td key={cj} className="num" style={{ minWidth: 70 }}>
                        {i === j ? <span className="muted">1</span> : j < i ? <span className="muted small">{a.corr[i][j].toFixed(2)}</span> : (
                          <NumberInput ariaLabel={`Correlation of ${FACTOR_LABELS[ri]} and ${FACTOR_LABELS[cj]}`} value={a.corr[i][j]} min={-0.95} max={0.95} step={0.05} decimals={2}
                            onChange={(v) => setA((x) => {
                              const c = x.corr.map((r) => r.slice());
                              const val = Math.max(-0.95, Math.min(0.95, v ?? 0));
                              c[i][j] = val;
                              c[j][i] = val;
                              return { ...x, corr: c };
                            })} />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ChartFrame
            chart={<CorrelationHeatmap labels={FACTOR_ORDER.map((k) => FACTOR_SHORT[k])} matrix={a.corr} height={400} ariaLabel="Correlation matrix of market factors" />}
            note="Blue cells move together; red cells move in opposite directions. A weaker rupee goes with lower PSX prices and higher rates and inflation, which is what makes devaluations painful."
          />
        )}
      </Card>

      <Card className="chart-card" title="History and a backtest of your mix" sub={`Growth of 100 from the end of ${range} to ${HISTORY_LAST}, yearly · your mix uses today’s weights of ${active.name}`}
        actions={<Seg size="sm" label="Start year" value={range} onChange={setRange} options={[{ value: '2006', label: '2006' }, { value: '2010', label: '2010' }, { value: '2015', label: '2015' }, { value: '2020', label: '2020' }]} />}>
        <div className="stack">
          <div className="stats">
            <Stat plain label="Your mix, per year" value={fmt.pct(bt.cagr * 100, 1)} note={`${fmt.pct(bt.realCagr * 100, 1)} after inflation`} />
            <Stat plain label="KSE-100, per year" value={fmt.pct(bt.kseCagr * 100, 1)} note="price index, PKR" />
            <Stat plain label="Best year" value={fmt.pct(bt.best.ret * 100, 0, true)} note={String(bt.best.year)} />
            <Stat plain label="Worst year" value={fmt.pct(bt.worst.ret * 100, 0, true)} note={String(bt.worst.year)} />
            <Stat plain label="Largest fall" value={fmt.pct(-bt.maxDD * 100, 0)} note="peak to trough, year ends" />
          </div>
          <ChartFrame
            legend={hist.series.map((s) => <LegendItem key={s.name} kind="line" color={s.color} label={s.name} />)}
            chart={<MultiLineChart labels={hist.labels} series={hist.series} fmtVal={fmtIdx} fmtAxis={fmtIdx} height={340} endLabels={false} ariaLabel="Indexed history of markets and the backtest of your mix" />}
            table={() => (
              <table className="t compact"><thead><tr><th>Year</th>{hist.series.map((s) => <th key={s.name} className="num">{s.name}</th>)}<th className="num">Your mix, that year</th></tr></thead>
                <tbody>{hist.labels.map((l, i) => <tr key={l}><td>{l}</td>{hist.series.map((s) => <td key={s.name} className="num">{(s.data[i] as number).toFixed(0)}</td>)}<td className="num">{i === 0 ? '–' : fmt.pct(bt.yearly[i - 1] * 100, 1, true)}</td></tr>)}</tbody>
              </table>
            )}
            note={<>KSE-100 year-end closes from 2004 ({KSE100[2004].toLocaleString('en-US')}) to 2025 ({KSE100[2025].toLocaleString('en-US')}) are a price index without dividends. Other series are approximate yearly values: S&P 500 total return, gold in USD, bitcoin, T-bill averages and CPI. Property is proxied by inflation plus 1%. Past returns do not predict future ones.</>}
          />
        </div>
      </Card>

      <Sources items={[
        ...feedSources(feedCtx.feed),
        ...[SOURCES.kse, SOURCES.kseHistory, SOURCES.global, SOURCES.rent].map((s) => ({ label: s.label, url: s.url, asOf: s.asOf })),
        ...(feedCtx.feed ? [] : [SOURCES.policy, SOURCES.cpi, SOURCES.tbill, SOURCES.nss, SOURCES.fx, SOURCES.gold, SOURCES.btc, SOURCES.eurusd, SOURCES.npc].map((s) => ({ label: s.label, url: s.url, asOf: s.asOf }))),
      ]} />
      <div className="row" style={{ gap: 6 }}>
        <Badge>{m.feedAt ? `Daily data ${fmtDate(m.asOf)}` : `Snapshot ${fmtDate(DEFAULT_MARKET.asOf)}`}</Badge>
        <span className="mini-help">{m.feedAt
          ? `Rates, exchange rates, gold, National Savings, crypto${feedCtx.funds ? ', fund NAVs' : ''}${feedCtx.psx ? ', PSX share prices and index levels' : ''} refresh every morning (Pakistan time). ${feedCtx.psx ? 'Global share prices and the S&P 500 are' : 'Global share prices are'} not included: update them on the Holdings screen or import a statement.`
          : 'Prices are not live. Update them here, or update each holding’s price on the Holdings screen.'}</span>
      </div>

      {editMarket && <MarketModal value={m} hasFeed={!!feedCtx.feed} onClose={() => setEditMarket(false)}
        onSave={(next) => {
          const changed = changedKeys(m, next);
          update((w) => ({ ...w, market: { ...next, locked: Array.from(new Set([...(w.market.locked ?? []), ...changed])) } }));
          setEditMarket(false);
          toast(changed.length ? 'Market data updated; daily updates will leave your figures alone' : 'No changes');
        }}
        onReset={() => { switchToDaily(); setEditMarket(false); }} />}
    </div>
  );
}

function MarketModal({ value, hasFeed, onClose, onSave, onReset }: { value: MarketSnapshot; hasFeed: boolean; onClose: () => void; onSave: (m: MarketSnapshot) => void; onReset: () => void }) {
  const [m, setM] = useState<MarketSnapshot>(() => JSON.parse(JSON.stringify(value)));
  const today = todayISO();
  const num = (label: string, v: number, set: (n: number) => void, suffix?: string) => (
    <Field label={label} htmlFor={'mk-' + label}><NumberInput id={'mk-' + label} value={v} onChange={(x) => set(Math.max(0, x ?? 0))} suffix={suffix} decimals={4} /></Field>
  );
  return (
    <Modal wide title="Update market data" onClose={onClose} footer={<>
      <Button variant="danger" onClick={onReset}>{hasFeed ? 'Use the daily data' : 'Reset to snapshot'}</Button>
      <span style={{ flex: 1 }} />
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={() => onSave({ ...m, asOf: today })}>Save</Button>
    </>}>
      <div className="stack">
        <p className="small ink2">Enter figures from your broker, bank or a news site. Figures you change here are kept as you typed them: the daily data will not overwrite them until you choose to use it again. Forecast assumptions are not changed.</p>
        <div className="form-grid">
          {num('USD/PKR', m.fx.USD, (n) => setM((x) => ({ ...x, fx: { ...x.fx, USD: n, AED: Math.round((n / 3.6725) * 100) / 100, SAR: Math.round((n / 3.75) * 100) / 100 }, fxDate: today })), 'Rs')}
          {num('GBP/PKR', m.fx.GBP, (n) => setM((x) => ({ ...x, fx: { ...x.fx, GBP: n } })), 'Rs')}
          {num('EUR/PKR', m.fx.EUR, (n) => setM((x) => ({ ...x, fx: { ...x.fx, EUR: n } })), 'Rs')}
          {num('Gold, 24k per tola', m.goldTola, (n) => setM((x) => ({ ...x, goldTola: n, goldDate: today })), 'Rs')}
          {num('Silver per tola', m.silverTola, (n) => setM((x) => ({ ...x, silverTola: n, goldDate: today })), 'Rs')}
          {num('Gold per ounce', m.goldUsdOz, (n) => setM((x) => ({ ...x, goldUsdOz: n })), '$')}
          {num('Bitcoin', m.btcUsd, (n) => setM((x) => ({ ...x, btcUsd: n, btcDate: today })), '$')}
          {num('KSE-100', m.kse100, (n) => setM((x) => ({ ...x, kse100: n, kse100Date: today })))}
          {num('SBP policy rate', m.policyRate, (n) => setM((x) => ({ ...x, policyRate: n, policyDate: today })), '%')}
          {num('CPI inflation', m.cpi, (n) => setM((x) => ({ ...x, cpi: n })), '%')}
          {num('12-month T-bill', m.tbill.m12, (n) => setM((x) => ({ ...x, tbill: { ...x.tbill, m12: n, date: today } })), '%')}
          {num('3-month T-bill', m.tbill.m3, (n) => setM((x) => ({ ...x, tbill: { ...x.tbill, m3: n, date: today } })), '%')}
        </div>
        <p className="tiny muted">AED and SAR follow USD through their dollar pegs.</p>
      </div>
    </Modal>
  );
}

const LOCK_LABELS: Record<string, string> = {
  fx: 'exchange rates', goldTola: 'gold', silverTola: 'silver', goldUsdOz: 'gold in USD', btcUsd: 'bitcoin', kse100: 'KSE-100',
  policyRate: 'policy rate', cpi: 'inflation', tbill: 'T-bills',
};

/** Market fields the user changed in the edit dialog. */
function changedKeys(a: MarketSnapshot, b: MarketSnapshot): string[] {
  const out: string[] = [];
  if (JSON.stringify(a.fx) !== JSON.stringify(b.fx)) out.push('fx');
  for (const k of ['goldTola', 'silverTola', 'goldUsdOz', 'btcUsd', 'kse100', 'policyRate', 'cpi'] as const) if (a[k] !== b[k]) out.push(k);
  if (a.tbill.m12 !== b.tbill.m12 || a.tbill.m3 !== b.tbill.m3) out.push('tbill');
  return out;
}

const CRYPTO_SHOWN = ['BTC', 'ETH', 'USDT', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'TON', 'TRX'];

function fmtCoin(v: number): string {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return v.toLocaleString('en-US', { maximumSignificantDigits: 4 });
}

/** '22 Oct, 12:15 am' in Pakistan time. */
function fmtStamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).replace(',', ' at') + ' PKT';
  } catch {
    return fmtDate(iso.slice(0, 10));
  }
}

function ageDays(date?: string): number | undefined {
  if (!date) return undefined;
  const d = /^\d{4}-\d{2}$/.test(date) ? `${date}-28` : date.slice(0, 10);
  const t = Date.parse(d + 'T00:00:00Z');
  return isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : undefined;
}

function feedSources(f: FeedDoc | null): { label: string; url: string; asOf: string }[] {
  if (!f?.sourceInfo) return [];
  // The MUFAP scraper is a fallback that normally does not run; list it only when it did.
  return Object.entries(f.sourceInfo).filter(([k]) => k !== 'mufap' || f.status?.mufap).map(([, s]) => ({ label: s.label, url: s.url, asOf: 'daily' }));
}

function PsxIndices({ ix, breadth, count }: { ix: NonNullable<MarketSnapshot['psxIndices']>; breadth?: { advance?: number; decline?: number; unchanged?: number }; count?: number }) {
  const NAMES: [string, string][] = [['KSE100', 'KSE-100'], ['KSE30', 'KSE-30'], ['KMI30', 'KMI-30 (Shariah)'], ['ALLSHR', 'All Share'], ['KMIALLSHR', 'KMI All Share (Shariah)']];
  const rows = NAMES.filter(([k]) => ix.rows[k]);
  return (
    <Card className="span-6" title="PSX indices" sub={ix.intraday && ix.time ? `At ${ix.time} on ${fmtDate(ix.date)}, during trading` : `Close on ${fmtDate(ix.date)}`}>
      <div className="table-wrap">
        <table className="t compact">
          <thead><tr><th>Index</th><th className="num">Level</th><th className="num">Change</th><th className="num">%</th></tr></thead>
          <tbody>
            {rows.map(([k, label]) => {
              const r = ix.rows[k];
              const tone = r.chg === undefined || r.chg === 0 ? '' : r.chg > 0 ? ' up' : ' down';
              return (
                <tr key={k}>
                  <td className="strong">{label}</td>
                  <td className="num">{r.v.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                  <td className={'num' + tone}>{r.chg === undefined ? '–' : `${r.chg > 0 ? '+' : ''}${r.chg.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}</td>
                  <td className={'num' + tone}>{r.chgPct === undefined ? '–' : `${r.chgPct > 0 ? '+' : ''}${r.chgPct.toFixed(2)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mini-help" style={{ marginTop: 10 }}>
        {breadth?.advance !== undefined ? `${breadth.advance} shares rose, ${breadth.decline ?? 0} fell and ${breadth.unchanged ?? 0} were unchanged. ` : ''}
        {count ? `PSX shares and ETFs you hold are valued at PSX’s price (${count} symbols in the daily list).` : ''}
      </p>
    </Card>
  );
}

function DailyData({ m, feed, funds, psx, state, autoOff }: { m: MarketSnapshot; feed: FeedDoc | null; funds: FundsDoc | null; psx: PsxDoc | null; state: 'loading' | 'ready' | 'none'; autoOff: boolean }) {
  if (state === 'loading') return null;
  if (!feed && !funds && !psx) {
    return (
      <Callout>
        The daily market data is not available in this view, so figures come from the built-in snapshot of {fmtDate(DEFAULT_MARKET.asOf)}. Signed-in viewers get rates, exchange rates, gold, National Savings, fund NAVs and PSX prices refreshed every morning.
      </Callout>
    );
  }
  const st = feed?.status ?? {};
  const src = feed?.sourceInfo ?? {};
  const rows: { key: string; label: string; what: string; asOf?: string; maxAge: number; status?: boolean; url?: string }[] = [
    { key: 'sbp', label: 'SBP rates', what: 'Policy rate, KIBOR, T-bills, interbank USD/PKR, reserves', asOf: m.kibor?.date ?? m.fxDate, maxAge: 4, status: st.sbp?.ok, url: src.sbp?.url },
    { key: 'sbp_open', label: 'Open-market rates', what: 'Exchange company buying and selling rates', asOf: m.fxOpenDate, maxAge: 4, status: st.sbp_open?.ok, url: src.sbp_open?.url },
    { key: 'psx', label: 'PSX prices', what: psx ? `${psx.count} shares and ETFs, KSE-100 and other indices` : 'Share and ETF prices, KSE-100 and other indices', asOf: psx?.asOf ?? m.psxIndices?.date, maxAge: 4, status: st.psx?.ok, url: src.psx?.url },
    { key: 'funds', label: 'Fund NAVs', what: funds ? `${funds.count} funds, pension sub-funds and ETFs` : 'Every MUFAP fund and pension sub-fund', asOf: funds ? funds.reportDate ?? funds.asOf : undefined, maxAge: 4, status: st.funds?.ok ?? st.mufap?.ok, url: funds?.source?.url ?? src.funds?.url ?? src.mufap?.url },
    { key: 'cdns', label: 'National Savings', what: 'Profit rates of every scheme', asOf: m.nssDate, maxAge: 400, status: st.cdns?.ok, url: src.cdns?.url },
    { key: 'gold', label: 'Gold and silver', what: 'Sarafa rate per tola, 24 karat', asOf: m.goldDate, maxAge: 4, url: src[feed?.sources?.goldTola ?? '']?.url },
    { key: 'fx', label: 'Crosses, metals, crypto', what: 'Other currencies, spot gold, 20+ coins', asOf: m.cryptoDate, maxAge: 4, status: st.fx?.ok, url: src.fx?.url },
    { key: 'pbs', label: 'Inflation', what: `CPI, year on year (${m.cpiMonth})`, asOf: undefined, maxAge: 999, status: st.pbs?.ok, url: src.pbs?.url },
    { key: 'us', label: 'US rates', what: 'Treasury yields and fed funds', asOf: m.usDate, maxAge: 5, status: st.treasury?.ok, url: src.treasury?.url },
  ];
  const shown = rows.filter((r) => !(r.key === 'funds' && !funds && !st.funds && (!st.mufap || st.mufap.disabled)) && !(r.key === 'psx' && !psx && !st.psx));
  return (
    <Card title="Daily data" sub={feed ? `Refreshed every morning (Pakistan time) · last update ${fmtStamp(feed.updatedAt)}${autoOff ? ' · automatic updates are off in Settings' : ''}` : 'Fund NAVs and PSX prices available'}>
      <div className="feed-list">
        {shown.map((r) => {
          const age = ageDays(r.asOf);
          const tone = r.status === false ? 'warn' : age !== undefined && age > r.maxAge ? 'warn' : 'good';
          const label = r.status === false ? 'Last good figures' : age !== undefined && age > r.maxAge ? 'Behind' : 'Current';
          return (
            <div key={r.key} className="feed-item">
              <div className="fi-top"><span className="strong">{r.label}</span><Pill tone={tone}>{label}</Pill></div>
              <span className="fi-what">{r.what}</span>
              <span className="small ink2">{r.asOf ? `As of ${fmtDate(r.asOf)}` : r.key === 'pbs' ? `Latest month: ${m.cpiMonth}` : 'Not yet available'}{r.url ? <> · <a href={r.url} target="_blank" rel="noreferrer">source</a></> : null}</span>
            </div>
          );
        })}
      </div>
      {feed?.notes?.length ? <p className="mini-help" style={{ marginTop: 10 }}>{feed.notes.join(' ')}</p> : null}
    </Card>
  );
}

/** Rates shown to two decimals (SBP publishes cut-offs like 12.4999%); full precision stays in the data. */
function pct2(v: number | undefined): string {
  return v === undefined || !isFinite(v) ? '–' : `${v.toFixed(2)}%`;
}
