import React, { useEffect, useMemo, useState } from 'react';
import { FACTOR_LABELS } from '../../engine/assumptions';
import { CLASS_META } from '../../engine/catalog';
import { uid } from '../../engine/format';
import { recoveryMonths, runStress, STRESS_PRESETS } from '../../engine/stress';
import type { ShockKey, Shocks } from '../../engine/types';
import { FACTOR_ORDER } from '../../engine/types';
import { filtersActive } from '../../engine/valuation';
import { useRisk } from '../../state/analytics';
import { aiErrorCopy } from '../../state/claude';
import { useFilteredHoldings, useUI, useWS } from '../../state/store';
import { getSample, opusQuick } from '../ai/client';
import { ChartFrame, classColor, useColors } from '../charts/base';
import { DivergingBars } from '../charts/charts';
import { Icon } from '../components/Icon';
import { Button, Callout, Card, Empty, Seg, Slider, Stat } from '../components/primitives';
import { useFmt } from '../fmt';
import { ExampleBanner, PageHead } from './common';

// Shared so memos keyed on the liabilities list stay stable while filters are on.
const NO_LIABILITIES: never[] = [];

const RANGES: Record<ShockKey, { min: number; max: number; step: number; unit: '%' | 'pts' }> = {
  psx: { min: -70, max: 60, step: 1, unit: '%' },
  gleq: { min: -60, max: 40, step: 1, unit: '%' },
  glbond: { min: -30, max: 20, step: 1, unit: '%' },
  gold: { min: -40, max: 40, step: 1, unit: '%' },
  re: { min: -40, max: 30, step: 1, unit: '%' },
  crypto: { min: -90, max: 150, step: 1, unit: '%' },
  fx: { min: -20, max: 80, step: 1, unit: '%' },
  rate: { min: -8, max: 12, step: 0.25, unit: 'pts' },
  cpi: { min: -6, max: 30, step: 0.5, unit: 'pts' },
};

type Sel = { kind: 'preset'; key: string } | { kind: 'saved'; id: string } | { kind: 'custom' };
type Lens = 'pkr' | 'usd' | 'real';

function shockText(s: Shocks): string {
  return FACTOR_ORDER.filter((k) => s[k]).map((k) => `${FACTOR_LABELS[k]} ${s[k]! > 0 ? '+' : ''}${s[k]}${RANGES[k].unit === 'pts' ? ' pts' : '%'}`).join(', ');
}

let LAST: { sel: Sel; custom: Shocks } | null = null;

export function Stress() {
  const { ws, active, updatePortfolio } = useWS();
  const { askAI, filters, toast, openEditor } = useUI();
  const holdings = useFilteredHoldings();
  const fmt = useFmt();
  const colors = useColors();
  const risk = useRisk();
  const [sel, setSel] = useState<Sel>(LAST?.sel ?? { kind: 'preset', key: 'bop2022' });
  const [custom, setCustom] = useState<Shocks>(LAST?.custom ?? { ...STRESS_PRESETS[1].shocks });
  const [lens, setLens] = useState<Lens>('pkr');
  const [desc, setDesc] = useState('');
  const [ai, setAi] = useState<{ busy: boolean; msg?: string; available: boolean }>({ busy: false, available: false });
  const [saveName, setSaveName] = useState('');
  useEffect(() => {
    getSample().then((s) => setAi((a) => ({ ...a, available: !!s })));
  }, []);
  useEffect(() => {
    LAST = { sel, custom };
  }, [sel, custom]);

  const liabilities = filtersActive(filters) ? NO_LIABILITIES : active.liabilities;
  const saved = active.scenarios;
  const current = useMemo(() => {
    if (sel.kind === 'preset') {
      const p = STRESS_PRESETS.find((x) => x.key === sel.key) ?? STRESS_PRESETS[0];
      return { name: p.name, description: p.description, shocks: p.shocks, period: p.period };
    }
    if (sel.kind === 'saved') {
      const s = saved.find((x) => x.id === sel.id);
      if (s) return { name: s.name, description: s.note ?? shockText(s.shocks), shocks: s.shocks, period: s.source === 'ai' ? 'From your description' : 'Saved scenario' };
    }
    return { name: 'Custom scenario', description: shockText(custom) || 'Move the sliders to build a scenario.', shocks: custom, period: 'Custom' };
  }, [sel, saved, custom]);

  const result = useMemo(() => runStress(holdings, liabilities, ws.market, current.shocks), [holdings, liabilities, ws.market, current.shocks]);
  const fx = (current.shocks.fx ?? 0) / 100;
  const inflYear = Math.max(0, ws.market.cpi + (current.shocks.cpi ?? 0)) / 100;
  const usdPct = ((1 + result.changePct / 100) / (1 + fx) - 1) * 100;
  const realPct = ((1 + result.changePct / 100) / (1 + inflYear) - 1) * 100;
  const expected = risk.report ? risk.report.mean * 100 : 10;
  const rec = recoveryMonths(result.changePct, expected);

  const bars = useMemo(() => {
    const labels = result.byClass.map((c) => CLASS_META[c.cls].label);
    const values = result.byClass.map((c) => fmt.conv(c.change));
    if (result.liabilityChange) {
      labels.push('Foreign-currency debt');
      values.push(fmt.conv(-result.liabilityChange));
    }
    return { labels, values };
  }, [result, fmt]);

  const overview = useMemo(() => {
    const all = [
      ...STRESS_PRESETS.map((p) => ({ key: p.key, name: p.name, shocks: p.shocks })),
      ...saved.map((s) => ({ key: s.id, name: s.name, shocks: s.shocks })),
    ];
    return all.map((p) => {
      const r = runStress(holdings, liabilities, ws.market, p.shocks);
      const f = (p.shocks.fx ?? 0) / 100;
      const inf = Math.max(0, ws.market.cpi + (p.shocks.cpi ?? 0)) / 100;
      return { ...p, pkr: r.changePct, usd: ((1 + r.changePct / 100) / (1 + f) - 1) * 100, real: ((1 + r.changePct / 100) / (1 + inf) - 1) * 100 };
    });
  }, [holdings, liabilities, ws.market, saved]);
  const overviewVals = useMemo(() => overview.map((o) => o[lens]), [overview, lens]);
  const overviewLabels = useMemo(() => overview.map((o) => o.name), [overview]);

  const setShock = (k: ShockKey, v: number) => {
    const baseShocks = sel.kind === 'custom' ? custom : current.shocks;
    setCustom({ ...baseShocks, [k]: v });
    setSel({ kind: 'custom' });
  };

  const saveCustom = () => {
    const name = saveName.trim() || `My scenario ${saved.length + 1}`;
    const s = { id: uid('scn'), name, shocks: { ...custom }, source: 'custom' as const };
    updatePortfolio((p) => ({ ...p, scenarios: [...p.scenarios, s] }));
    setSel({ kind: 'saved', id: s.id });
    setSaveName('');
    toast('Scenario saved');
  };

  const fromSentence = async () => {
    const s = await getSample();
    if (!s || !desc.trim()) return;
    setAi((a) => ({ ...a, busy: true, msg: undefined }));
    try {
      const out = await s.json<{ name?: string; note?: string; shocks?: Record<string, unknown> }>(
        `Convert this market scenario into instant shocks for a Pakistan-focused portfolio stress test.
Scenario: """${desc.slice(0, 800)}"""
Today: KSE-100 ${ws.market.kse100.toLocaleString('en-US')}, USD/PKR ${ws.market.fx.USD}, SBP policy rate ${ws.market.policyRate}%, CPI ${ws.market.cpi}%, gold $${ws.market.goldUsdOz}/oz.
Return only JSON: {"name": short title, "note": one sentence describing the scenario and any assumptions you made, "shocks": {"psx": % change in PSX equities, "gleq": % change in global equities in USD, "glbond": % change in USD bonds, "gold": % change in gold in USD, "re": % change in Pakistan property, "crypto": % change in crypto in USD, "fx": % change in USD/PKR (positive = rupee weakens), "rate": change in the PKR policy rate in percentage points, "cpi": change in Pakistan inflation in percentage points}}.
Use the numbers the scenario states. Fill unstated factors with plausible co-moves based on Pakistan's history (rupee crises usually bring PSX falls, rate hikes and higher inflation); use 0 where a factor would not move. Keep values realistic.`,
        opusQuick(),
      );
      const shocks: Shocks = {};
      for (const k of FACTOR_ORDER) {
        const n = Number(out.shocks?.[k]);
        if (isFinite(n) && n !== 0) shocks[k] = Math.max(RANGES[k].min, Math.min(RANGES[k].max, Math.round(n * 4) / 4));
      }
      if (!Object.keys(shocks).length) throw { code: 'invalid_json' };
      const scn = { id: uid('scn'), name: (out.name || 'AI scenario').slice(0, 60), shocks, source: 'ai' as const, note: out.note?.slice(0, 300) };
      updatePortfolio((p) => ({ ...p, scenarios: [...p.scenarios, scn] }));
      setSel({ kind: 'saved', id: scn.id });
      setCustom(shocks);
      setAi((a) => ({ ...a, busy: false, msg: 'Scenario built and saved. Check the shocks below; move any slider to adjust.' }));
      setDesc('');
    } catch (e) {
      setAi((a) => ({ ...a, busy: false, msg: aiErrorCopy(e) }));
    }
  };

  const explain = () => {
    askAI(
      `Explain what this stress test means for me and what I could do now to soften a hit like this. Scenario: ${current.name} (${shockText(current.shocks)}). Net worth changes by ${fmt.money(result.change, { sign: true })} (${result.changePct.toFixed(1)}% in rupees, ${usdPct.toFixed(1)}% in dollars, ${realPct.toFixed(1)}% in today's money after a year of inflation). By class: ${result.byClass.map((c) => `${CLASS_META[c.cls].label} ${fmt.money(c.change, { sign: true })}`).join(', ')}. Worst holdings: ${result.holdings.slice(0, 4).map((h) => `${h.name} ${(h.pct * 100).toFixed(0)}%`).join(', ')}.`,
      true,
      `Explain the ${current.name} stress test`,
    );
  };

  if (!holdings.length) {
    return (
      <div className="stack">
        <PageHead title="Stress tests" />
        <Card><Empty icon="stress" title="Nothing to stress yet" action={<Button variant="primary" icon="plus" onClick={() => openEditor(null)}>Add holding</Button>}>Add holdings, or clear the filters, to see how a crash would hit them.</Empty></Card>
      </div>
    );
  }

  const shockVal = (k: ShockKey) => (sel.kind === 'custom' ? custom[k] : current.shocks[k]) ?? 0;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Stress tests"
        sub="See the damage before it happens: market shocks applied instantly to every holding through its exposure to PSX, global markets, gold, property, crypto, the rupee and interest rates."
        actions={<Button variant="ai" icon="sparkle" onClick={explain}>Explain with AI</Button>}
      />
      <ExampleBanner />
      <Card title="Choose a scenario" sub="Historical episodes, hypothetical shocks and your own">
        <div className="scenario-grid">
          {STRESS_PRESETS.map((p) => (
            <button key={p.key} type="button" className="scenario-btn" aria-pressed={sel.kind === 'preset' && sel.key === p.key} onClick={() => setSel({ kind: 'preset', key: p.key })}>
              <span className="sb-name">{p.name}</span>
              <span className="sb-meta">{p.kind === 'historical' ? `Historical · ${p.period}` : p.kind === 'upside' ? 'Upside case' : 'Hypothetical'}</span>
            </button>
          ))}
          {saved.map((s) => (
            <div key={s.id} style={{ position: 'relative' }}>
              <button type="button" className="scenario-btn" style={{ width: '100%', paddingRight: 36 }} aria-pressed={sel.kind === 'saved' && sel.id === s.id} onClick={() => { setSel({ kind: 'saved', id: s.id }); setCustom({ ...s.shocks }); }}>
                <span className="sb-name">{s.name}</span>
                <span className="sb-meta">{s.source === 'ai' ? 'Built by AI from your words' : 'Saved by you'}</span>
              </button>
              <Button size="sm" variant="ghost" iconOnly icon="trash" style={{ position: 'absolute', top: 6, right: 4 }} onClick={() => {
                updatePortfolio((p) => ({ ...p, scenarios: p.scenarios.filter((x) => x.id !== s.id) }));
                if (sel.kind === 'saved' && sel.id === s.id) setSel({ kind: 'custom' });
              }}>Delete {s.name}</Button>
            </div>
          ))}
          <button type="button" className="scenario-btn" aria-pressed={sel.kind === 'custom'} onClick={() => setSel({ kind: 'custom' })}>
            <span className="sb-name">Custom</span>
            <span className="sb-meta">Set every shock yourself</span>
          </button>
        </div>
        {ai.available && (
          <div className="stack" style={{ gap: 6, marginTop: 14 }}>
            <label className="small strong" htmlFor="st-desc">Or describe a scenario in a sentence</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input id="st-desc" className="input" placeholder="e.g. The rupee falls 25% and the KSE-100 drops 30% while gold rallies" value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fromSentence()} />
              <Button variant="ai" icon="sparkle" onClick={fromSentence} disabled={ai.busy || !desc.trim()}>{ai.busy ? 'Building…' : 'Build'}</Button>
            </div>
            {ai.msg && <span className="tiny muted">{ai.msg}</span>}
          </div>
        )}
      </Card>

      <div className="split">
        <Card className="sticky-panel" title="Shocks" sub={sel.kind === 'custom' ? 'Your custom scenario' : 'Move a slider to customise'}>
          <div className="stack" style={{ gap: 12 }}>
            {FACTOR_ORDER.map((k) => {
              const v = shockVal(k);
              const rg = RANGES[k];
              return (
                <Slider key={k} label={FACTOR_LABELS[k]} value={v} min={rg.min} max={rg.max} step={rg.step} onChange={(x) => setShock(k, x)}
                  display={`${v > 0 ? '+' : ''}${v}${rg.unit === 'pts' ? ' pts' : '%'}`} />
              );
            })}
            {sel.kind === 'custom' && (
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input className="input" aria-label="Scenario name" placeholder="Name this scenario" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
                <Button icon="check" onClick={saveCustom}>Save</Button>
              </div>
            )}
            <p className="tiny muted">USD/PKR up means the rupee weakens, which raises the rupee value of gold, foreign currency, global and crypto holdings. Rates and inflation are in percentage points.</p>
          </div>
        </Card>
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <Card>
            <div className="stack" style={{ gap: 4 }}>
              <div className="row" style={{ gap: 8 }}><span className="card-title" style={{ fontSize: 16 }}>{current.name}</span>{current.period && <span className="badge">{current.period}</span>}</div>
              <p className="small ink2">{current.description}</p>
            </div>
          </Card>
          <div className="stats">
            <Stat label="Change in net worth" value={<span className={result.change >= 0 ? 'up' : 'down'}>{fmt.money(result.change, { sign: true })}</span>} note={`${fmt.pct(result.changePct, 1, true)} in rupees`} />
            <Stat label="In dollar terms" value={<span className={usdPct >= 0 ? 'up' : 'down'}>{fmt.pct(usdPct, 1, true)}</span>} note={fx ? `USD/PKR ${fx > 0 ? '+' : ''}${(fx * 100).toFixed(0)}%` : 'rupee unchanged'} />
            <Stat label="In today’s money" value={<span className={realPct >= 0 ? 'up' : 'down'}>{fmt.pct(realPct, 1, true)}</span>} note={`after a year of ${fmt.pct(inflYear * 100, 0)} inflation`} />
            <Stat label="Net worth after" value={fmt.money(result.after)} note={`from ${fmt.money(result.before)}`} />
            <Stat label="Time to recover" value={result.changePct >= 0 ? 'No loss' : rec === null ? '–' : rec < 12 ? `${rec} months` : `${(rec / 12).toFixed(1)} years`} note={result.changePct >= 0 ? 'in rupee terms' : `at ${fmt.pct(expected, 1)} a year expected return`} />
          </div>
          {result.changePct > 0 && realPct < 0 && (
            <Callout tone="warn">The rupee value rises, but that is the devaluation talking: in dollars and in today’s money this portfolio loses value in this scenario.</Callout>
          )}
          <Card className="chart-card" title="Impact by asset class" sub={`Gain or loss in ${fmt.base === 'USD' ? 'dollars at today’s rate' : 'rupees'}`}>
            <ChartFrame
              chart={<DivergingBars labels={bars.labels} values={bars.values} fmtVal={fmt.baseC} fmtAxis={fmt.axis} height={Math.max(180, bars.labels.length * 38)} ariaLabel="Stress impact by asset class" />}
              table={() => (
                <table className="t compact"><thead><tr><th>Class</th><th className="num">Before</th><th className="num">Change</th><th className="num">Change %</th></tr></thead>
                  <tbody>{result.byClass.map((c) => <tr key={c.cls}><td>{CLASS_META[c.cls].label}</td><td className="num">{fmt.money(c.before)}</td><td className={'num ' + (c.change >= 0 ? 'up' : 'down')}>{fmt.money(c.change, { sign: true })}</td><td className="num">{c.before ? fmt.pct((c.change / c.before) * 100, 1, true) : '–'}</td></tr>)}</tbody>
                </table>
              )}
            />
          </Card>
          <Card flush title="Holdings ranked by impact" sub="Largest losses first">
            <div className="table-wrap">
              <table className="t compact">
                <thead><tr><th>Holding</th><th className="num">Value now</th><th className="num">Change</th><th className="num">Change %</th></tr></thead>
                <tbody>
                  {result.holdings.slice(0, 12).map((h) => (
                    <tr key={h.id}>
                      <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><span className="swatch" style={{ background: classColor(colors, CLASS_META[h.cls].slot) }} /><span className="cell-name"><span className="n1">{h.name}</span></span></div></td>
                      <td className="num">{fmt.money(h.before)}</td>
                      <td className={'num ' + (h.change >= 0 ? 'up' : 'down')}>{fmt.money(h.change, { sign: true })}</td>
                      <td className="num">{fmt.pct(h.pct * 100, 1, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <Card className="chart-card" title="Every scenario at a glance" sub="Instant change in net worth"
        actions={<Seg size="sm" label="Measure in" value={lens} onChange={setLens} options={[{ value: 'pkr', label: 'Rupees' }, { value: 'usd', label: 'Dollars' }, { value: 'real', label: "Today's money" }]} />}>
        <ChartFrame
          chart={<DivergingBars labels={overviewLabels} values={overviewVals} fmtVal={fmtSigned} fmtAxis={fmtAxisPct} height={Math.max(260, overview.length * 30)} ariaLabel="Net worth change under every stress scenario" />}
          table={() => (
            <table className="t compact"><thead><tr><th>Scenario</th><th className="num">Rupees</th><th className="num">Dollars</th><th className="num">Today’s money</th></tr></thead>
              <tbody>{overview.map((o) => <tr key={o.key}><td>{o.name}</td><td className="num">{fmt.pct(o.pkr, 1, true)}</td><td className="num">{fmt.pct(o.usd, 1, true)}</td><td className="num">{fmt.pct(o.real, 1, true)}</td></tr>)}</tbody>
            </table>
          )}
          note={<span className="row" style={{ gap: 6 }}><Icon name="info" size={13} />Instant repricing of today’s holdings. It ignores income earned and any recovery during the episode, and fixed-rate products such as NSS hold their value.</span>}
        />
      </Card>
    </div>
  );
}

const fmtSigned = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtAxisPct = (v: number) => `${v}%`;
