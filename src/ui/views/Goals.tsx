import React, { useEffect, useMemo, useState } from 'react';
import { GOAL_PRESETS } from '../../engine/catalog';
import { buildSim } from '../../engine/exposures';
import { addMonthsISO, fmtDate, fmtMoney, monthsBetween, todayISO, uid } from '../../engine/format';
import { requiredExtraSip, solveRequiredSip } from '../../engine/simulate';
import type { Goal, GoalKind, RetirementPlan } from '../../engine/types';
import { emergencyAssets } from '../alerts';
import { useForecast } from '../../state/analytics';
import { runSim } from '../../state/simClient';
import { useFilteredHoldings, useUI, useWS } from '../../state/store';
import { ownCounts, useEntitlements } from '../../state/entitlements';
import { getSample, opusQuick } from '../ai/client';
import { aiErrorCopy } from '../../state/claude';
import { ChartFrame, LegendItem, alpha, useColors } from '../charts/base';
import { BandLineChart, FanChart } from '../charts/charts';
import { Icon } from '../components/Icon';
import { Badge, Button, Callout, Card, Empty, Field, Meter, Modal, NumberInput, Pill, Select, Slider, Spinner, Stat, Toggle, probLabel, probTone } from '../components/primitives';
import { useFmt } from '../fmt';
import { ExampleBanner, PageHead } from './common';
import { makeConverter } from './Forecast';
import { forecastSeries } from './Overview';

const KIND_ICON: Record<GoalKind, string> = {
  retirement: 'wallet', education: 'file', home: 'home', hajj: 'globe', wedding: 'sparkle', emergency: 'lock', car: 'dot', custom: 'goals',
};
const KIND_LABEL: Record<GoalKind, string> = {
  retirement: 'Retirement', education: 'Education', home: 'Home', hajj: 'Hajj or Umrah', wedding: 'Wedding', emergency: 'Emergency fund', car: 'Car', custom: 'Custom',
};


export function Goals() {
  const { ws, active, updatePortfolio, update } = useWS();
  const { askAI, toast } = useUI();
  const holdings = useFilteredHoldings();
  const fmt = useFmt();
  const colors = useColors();
  const fc = useForecast({ samplePaths: 0 });
  const res = fc.res;
  const [edit, setEditRaw] = useState<Goal | null>(null);
  const ent = useEntitlements();
  // A new goal past the plan's limit asks for an upgrade instead.
  const setEdit = (g: Goal | null) => {
    if (g && !active.isExample && !active.goals.some((x) => x.id === g.id) && ownCounts(ws.portfolios).goals >= ent.limit('goals')) {
      ent.upgrade('goals');
      return;
    }
    setEditRaw(g);
  };
  const [safe, setSafe] = useState<{ need: number; state: 'idle' | 'running' | 'done' | 'error'; above?: boolean }>({ need: 0, state: 'idle' });
  const base = ws.settings.baseCurrency;
  const real = ws.settings.realTerms;
  const today = todayISO();
  const startYear = Number(today.slice(0, 4));
  const r = active.plan.retirement;
  const setRet = (p: Partial<RetirementPlan>) => {
    setSafe({ need: 0, state: 'idle' });
    updatePortfolio((x) => ({ ...x, plan: { ...x.plan, retirement: { ...x.plan.retirement, ...p } } }));
  };

  const view = useMemo(() => {
    if (!res) return null;
    const series = forecastSeries(res, base, real);
    const labels = res.points.map((mm) => String(startYear + Math.round(mm / 12)));
    const H = res.points.length - 1;
    const conv = makeConverter(res, base, real, ws.assumptions.macro.usInflation);
    const goals = res.goals
      .map((g) => {
        const goal = active.goals.find((x) => x.id === g.id);
        if (!goal) return null;
        const k = Math.min(H, Math.max(0, Math.round(monthsBetween(today, goal.date) / 12)));
        return { index: k, value: conv(g.targetNominal, k), name: goal.name, prob: g.prob };
      })
      .filter((x): x is { index: number; value: number; name: string; prob: number } => !!x);
    const realSeries = base === 'USD' ? res.usdReal : res.real;
    const ages = res.points.map((mm) => String(Math.round(r.age + mm / 12)));
    return { series, labels, H, goals, realSeries, ages };
  }, [res, base, real, active.goals, ws.assumptions.macro.usInflation, startYear, today, r.age]);

  const cards = useMemo(() => {
    return active.goals
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((goal) => {
        const g = res?.goals.find((x) => x.id === goal.id);
        const months = monthsBetween(today, goal.date);
        const targetAtDate = goal.target * Math.pow(1 + goal.inflation / 100, Math.max(0, months) / 12);
        let extra: number | null = null;
        const ki = fc.built?.goalKeep[goal.id];
        if (res && g && ki !== undefined && ki >= 0 && res.keepValues[ki]) extra = requiredExtraSip(res.keepValues[ki], res.keepUnits[ki], g.targetNominal, 0.8);
        return { goal, g, months, targetAtDate, extra };
      });
  }, [active.goals, res, fc.built, today]);

  // The linear estimate undershoots when an earlier goal can empty liquid assets; re-simulate to confirm.
  const [refined, setRefined] = useState<Record<string, { extra: number; prob: number }>>({});
  const refineKey = res && fc.built ? `${res.paths}:${res.months}:${fc.built.input.seed}:${cards.map((c) => `${c.goal.id}=${c.extra === null ? 'n' : Math.round(c.extra)}`).join('|')}` : '';
  useEffect(() => {
    setRefined({});
    if (!res || !fc.built) return;
    const built = fc.built;
    let alive = true;
    (async () => {
      for (const c of cards) {
        if (!alive) return;
        if (!c.g || c.extra === null || !isFinite(c.extra) || c.extra <= 0) continue;
        const ki = built.goalKeep[c.goal.id];
        if (ki === undefined || ki < 0) continue;
        const out = await solveRequiredSip({ values: res.keepValues[ki], units: res.keepUnits[ki] }, c.g.targetNominal, 0.8, async (x) => {
          const b = buildSim(active, holdings, ws, { sipMonthly: active.plan.sipMonthly + x, perClass: false, trackIncome: false });
          const rr = await runSim(b.input);
          return { values: rr.keepValues[ki], units: rr.keepUnits[ki] };
        }, 2);
        if (!alive) return;
        setRefined((m) => ({ ...m, [c.goal.id]: { extra: out.extra, prob: out.prob } }));
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [refineKey]);

  const emergency = useMemo(() => emergencyAssets(holdings, ws.market), [holdings, ws.market]);
  const exp = ws.settings.monthlyExpenses;
  const months = exp > 0 ? emergency / exp : 0;

  const saveGoal = (g: Goal) => {
    updatePortfolio((p) => ({ ...p, goals: p.goals.some((x) => x.id === g.id) ? p.goals.map((x) => (x.id === g.id ? g : x)) : [...p.goals, g] }));
    setEdit(null);
    toast('Goal saved');
  };
  const removeGoal = (id: string) => {
    updatePortfolio((p) => ({ ...p, goals: p.goals.filter((x) => x.id !== id) }));
    toast('Goal removed');
  };

  const findSafe = async () => {
    setSafe({ need: 0, state: 'running' });
    try {
      const survival = async (need: number) => {
        const p = { ...active, plan: { ...active.plan, retirement: { ...r, enabled: true, monthlyNeed: need } } };
        const built = buildSim(p, holdings, ws, { paths: 800, perClass: false, trackIncome: false });
        const out = await runSim(built.input);
        return out.survival?.prob ?? 0;
      };
      let lo = r.pension;
      let hi = Math.max(r.monthlyNeed * 3, 600_000);
      if ((await survival(hi)) >= 0.9) {
        setSafe({ need: hi, state: 'done', above: true });
        return;
      }
      if ((await survival(lo + 1)) < 0.9) {
        setSafe({ need: lo, state: 'done' });
        return;
      }
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        if ((await survival(mid)) >= 0.9) lo = mid;
        else hi = mid;
      }
      setSafe({ need: Math.floor(lo / 1000) * 1000, state: 'done' });
    } catch {
      setSafe({ need: 0, state: 'error' });
    }
  };

  const retireYears = r.retireAge - r.age;
  const retireValid = r.retireAge >= r.age && r.lifeAge > r.retireAge;
  // Investments (excluding property, net of debt) at retirement, median, in today's rupees.
  const corpusRealAtRetire = useMemo(() => {
    if (!res || !fc.built) return 0;
    const startM = Math.round(retireYears * 12);
    const ki = fc.built.input.keepMonths.indexOf(startM);
    let vals: number[];
    if (ki >= 0) vals = Array.from(res.keepValues[ki], (v, i) => v / (res.keepCpi[ki][i] || 1));
    else if (startM <= 0) {
      const fin = fc.built.input.assets.filter((x) => !x.synthetic && x.cls !== 4).reduce((t, x) => t + x.value0, 0);
      vals = [fin - (fc.built.input.plan.liabilities[0] ?? 0)];
    } else return 0;
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  }, [res, fc.built, retireYears]);
  const withdrawRate = corpusRealAtRetire > 0 ? (Math.max(0, r.monthlyNeed - r.pension) * 12) / corpusRealAtRetire : 0;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Goals"
        sub="The chance each goal is fully funded on time, from the same simulation as your forecast. Targets are in today’s money and grow with each goal’s own inflation."
        actions={<>
          <Button variant="primary" icon="plus" onClick={() => setEdit({ id: uid('g'), name: '', kind: 'custom', target: 5_000_000, date: addMonthsISO(today, 60), inflation: 8, priority: 'medium', withdraw: true })}>Add goal</Button>
          <Button variant="ai" icon="sparkle" disabled={!res} onClick={() => askAI(`Act as my goal coach. For each goal, say whether it is on track, the main risk to it, and one concrete change (monthly amount, date or target) that would lift the odds to about 80%. Use solve_required_sip or run_forecast where it helps.`, true, 'Coach me on my goals')}>Goal coach</Button>
        </>}
      />
      <ExampleBanner />

      {active.goals.length === 0 ? (
        <Card>
          <Empty icon="goals" title="No goals yet" action={<Button variant="primary" icon="plus" onClick={() => setEdit({ id: uid('g'), name: '', kind: 'custom', target: 5_000_000, date: addMonthsISO(today, 60), inflation: 8, priority: 'medium', withdraw: true })}>Add your first goal</Button>}>
            Add what you are saving for: a child’s education, Hajj, a home, a wedding or retirement. Each goal gets a probability of being funded and the monthly amount that would secure it.
          </Empty>
        </Card>
      ) : (
        <div className="grid">
          {cards.map(({ goal, g, months: mo, targetAtDate, extra }) => {
            const p = g?.prob ?? 0;
            const past = mo <= 0;
            const toneColor = p >= 0.8 ? colors.good : p >= 0.5 ? colors.warn : colors.critical;
            return (
              <section key={goal.id} className="card span-4">
                <div className="goal-card">
                  <div className="goal-top">
                    <div className="row" style={{ gap: 10, flexWrap: 'nowrap', minWidth: 0 }}>
                      <span className="ai-mark" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name={KIND_ICON[goal.kind]} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="goal-name">{goal.name}</div>
                        <div className="small muted">{KIND_LABEL[goal.kind]} · {fmtDate(goal.date)} · {goal.priority} priority</div>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                      <Button size="sm" variant="ghost" iconOnly icon="edit" onClick={() => setEdit(goal)}>Edit {goal.name}</Button>
                      <Button size="sm" variant="ghost" iconOnly icon="trash" onClick={() => removeGoal(goal.id)}>Remove {goal.name}</Button>
                    </div>
                  </div>
                  {past ? (
                    <Callout tone="warn">This goal’s date has passed. Edit the date to include it in the forecast.</Callout>
                  ) : !g ? (
                    <div className="row small muted"><Spinner /> Simulating…</div>
                  ) : (
                    <>
                      <div className="stack" style={{ gap: 6 }}>
                        <div className="row-between">
                          <span className="strong" style={{ fontSize: 22 }}>{Math.round(p * 100)}%</span>
                          <Pill tone={probTone(p)}>{probLabel(p)}</Pill>
                        </div>
                        <Meter value={p} color={toneColor} label={`${goal.name}: chance of full funding`} />
                        <span className="tiny muted">Chance of being fully funded on time · median path funds {Math.min(100, Math.round(g.medianFundedPct))}%</span>
                      </div>
                      <div className="goal-figs">
                        <div><div className="gf-l">Target today</div><div className="gf-v">{fmt.money(goal.target)}</div></div>
                        <div><div className="gf-l">At {goal.date.slice(0, 4)}</div><div className="gf-v">{fmt.pkr(targetAtDate)}</div></div>
                        <div><div className="gf-l">Years left</div><div className="gf-v">{(mo / 12).toFixed(1)}</div></div>
                      </div>
                      <div className="small ink2">
                        {(() => {
                          if (extra === null) return null;
                          const ref = refined[goal.id];
                          const x = ref ? ref.extra : extra;
                          if (!isFinite(x)) return 'Saving more alone cannot reach this in time; move the date or lower the target.';
                          if (x <= 0) return <span className="row" style={{ gap: 6 }}><Icon name="check" size={14} />At least 80% likely with your current plan.</span>;
                          return <>For an 80% chance, add {ref ? '' : 'about '}<strong>{fmt.money(x)}</strong> a month{active.plan.sipStepUp ? `, rising ${active.plan.sipStepUp}% a year` : ''}.{!ref && <span className="muted"> Checking…</span>}</>;
                        })()}
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        <Badge>{goal.withdraw ? 'Withdrawn on the date' : 'Corpus to reach'}</Badge>
                        <Badge>{goal.inflation}% cost inflation</Badge>
                      </div>
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {res && view && view.goals.length > 0 && (
        <Card className="chart-card" title="Goals on your wealth path" sub={`${real ? "Today's money" : 'Nominal'} · ${base} · diamonds mark each goal’s target on its date; withdrawals lower the path afterwards`}>
          <ChartFrame
            legend={<>
              <LegendItem kind="line" color={colors.series[0]} label="Median net worth" />
              <LegendItem color={alpha(colors.series[0], 0.45)} label="P25 to P75" />
              <LegendItem color={alpha(colors.series[0], 0.2)} label="P10 to P90" />
              <LegendItem color={colors.ink} label="Goal target" />
            </>}
            chart={<FanChart labels={view.labels} pct={view.series} goals={view.goals} fmtVal={fmt.baseC} fmtAxis={fmt.axis} height={320} dim={fc.loading} ariaLabel="Goals placed on the wealth forecast" />}
            table={() => (
              <table className="t compact"><thead><tr><th>Goal</th><th>Year</th><th className="num">Target</th><th className="num">Median net worth then</th><th className="num">Chance funded</th></tr></thead>
                <tbody>{view.goals.map((g) => <tr key={g.name}><td>{g.name}</td><td>{view.labels[g.index]}</td><td className="num">{fmt.base$(g.value)}</td><td className="num">{fmt.base$(view.series[3][g.index])}</td><td className="num">{Math.round(g.prob * 100)}%</td></tr>)}</tbody>
              </table>
            )}
          />
        </Card>
      )}

      <div className="grid">
        <Card className="span-8" title="Retirement drawdown" sub="Spend from the portfolio after you retire, rising with inflation, and see whether it lasts"
          actions={<Toggle checked={r.enabled} onChange={(b) => setRet({ enabled: b })} label="Include in forecast" />}>
          <div className="stack">
            <div className="form-grid">
              <Field label="Your age now" htmlFor="r-age"><NumberInput id="r-age" value={r.age} onChange={(v) => setRet({ age: Math.max(18, Math.min(90, Math.round(v ?? 35))) })} suffix="years" /></Field>
              <Field label="Retire at" htmlFor="r-ret"><NumberInput id="r-ret" value={r.retireAge} onChange={(v) => setRet({ retireAge: Math.max(30, Math.min(90, Math.round(v ?? 60))) })} suffix="years" /></Field>
              <Field label="Plan until age" htmlFor="r-life"><NumberInput id="r-life" value={r.lifeAge} onChange={(v) => setRet({ lifeAge: Math.max(50, Math.min(100, Math.round(v ?? 85))) })} suffix="years" /></Field>
              <Field label="Monthly spending need, today’s money" htmlFor="r-need"><NumberInput id="r-need" value={r.monthlyNeed} onChange={(v) => setRet({ monthlyNeed: Math.max(0, v ?? 0) })} prefix="Rs" groupStyle="lakh" step={10000} /></Field>
              <Field label="Pension or other income, today’s money" htmlFor="r-pen" hint="Reduces what the portfolio must pay"><NumberInput id="r-pen" value={r.pension} onChange={(v) => setRet({ pension: Math.max(0, v ?? 0) })} prefix="Rs" groupStyle="lakh" step={5000} /></Field>
            </div>
            {!retireValid && <Callout tone="warn">Retirement age cannot be before your current age, and the plan must run past retirement.</Callout>}
            {r.enabled && retireValid && res && view && (
              <>
                <div className="stats">
                  <Stat plain label={`Money lasts to age ${r.lifeAge}`} value={res.survival ? fmt.pct(res.survival.prob * 100, 0) : '…'} note="of simulated paths" />
                  <Stat plain label={`Investments at ${r.retireAge}`} value={corpusRealAtRetire > 0 ? fmt.money(corpusRealAtRetire) : '–'} note="median, today’s money, excluding property" />
                  <Stat plain label="Withdrawal rate" value={withdrawRate > 0 ? fmt.pct(withdrawRate * 100, 1) : '–'} note={withdrawRate > 0.045 ? 'high: above about 4% often runs out' : 'first-year spending ÷ investments'} />
                  <Stat plain label="If it runs out" value={res.survival?.depletionMedianMonth != null ? `age ${Math.round(r.age + res.survival.depletionMedianMonth / 12)}` : 'never'} note="median age, in failing paths" />
                </div>
                <ChartFrame
                  legend={<><LegendItem kind="line" color={colors.series[0]} label="Median" /><LegendItem color={alpha(colors.series[0], 0.3)} label="P10 to P90" /></>}
                  chart={<BandLineChart labels={view.ages} median={view.realSeries[3]} low={view.realSeries[1]} high={view.realSeries[5]} name="Net worth, today's money" fmtVal={fmt.baseC} fmtAxis={fmt.axis} height={240} ariaLabel="Net worth by age in today's money" />}
                  table={() => (
                    <table className="t compact"><thead><tr><th>Age</th><th className="num">P10</th><th className="num">Median</th><th className="num">P90</th></tr></thead>
                      <tbody>{view.ages.map((a, i) => <tr key={a + i}><td>{a}</td><td className="num">{fmt.base$(view.realSeries[1][i])}</td><td className="num">{fmt.base$(view.realSeries[3][i])}</td><td className="num">{fmt.base$(view.realSeries[5][i])}</td></tr>)}</tbody>
                    </table>
                  )}
                  note="Net worth by age in today’s money. Property counts in net worth but is never sold to pay spending, so liquid assets can run out while property remains."
                />
                <div className="row" style={{ gap: 10 }}>
                  <Button icon="search" onClick={findSafe} disabled={safe.state === 'running'}>{safe.state === 'running' ? 'Searching…' : 'Find safe monthly spending'}</Button>
                  {safe.state === 'running' && <Spinner />}
                  {safe.state === 'done' && (
                    <span className="small">
                      {safe.above ? <>More than <strong>{fmt.money(safe.need)}</strong> a month stays solvent in 9 of 10 paths.</> : <>About <strong>{fmt.money(safe.need)}</strong> a month in today’s money{r.pension ? ` (including your ${fmt.money(r.pension)} pension)` : ''} lasts to age {r.lifeAge} in 9 of 10 paths.</>}
                      {' '}<button type="button" className="linkbtn small" onClick={() => setRet({ monthlyNeed: safe.need })}>Use this</button>
                    </span>
                  )}
                  {safe.state === 'error' && <span className="small" style={{ color: 'var(--critical-ink)' }}>The search failed. Try again.</span>}
                </div>
              </>
            )}
            {!r.enabled && <p className="small muted">Turn this on to add retirement spending to the forecast. Spending starts at your retirement age, rises with simulated inflation and comes from liquid assets.</p>}
          </div>
        </Card>

        <Card className="span-4" title="Emergency fund" sub="Cash, savings and money market funds you can reach within days">
          <div className="stack">
            <div>
              <div className="strong" style={{ fontSize: 26 }}>{months.toFixed(1)} months</div>
              <div className="small muted">of expenses covered by {fmt.money(emergency)}</div>
            </div>
            <Meter value={Math.min(1, months / 6)} color={months >= 6 ? colors.good : months >= 3 ? colors.warn : colors.critical} label="Emergency fund coverage against a six-month target" />
            <Pill tone={months >= 6 ? 'good' : months >= 3 ? 'warn' : 'critical'}>{months >= 6 ? 'Six months or more' : months >= 3 ? 'Below six months' : 'Below three months'}</Pill>
            <Field label="Monthly household expenses" htmlFor="g-exp">
              <NumberInput id="g-exp" value={exp} onChange={(v) => update((w) => ({ ...w, settings: { ...w.settings, monthlyExpenses: Math.max(0, v ?? 0) } }))} prefix="Rs" groupStyle="lakh" step={10000} />
            </Field>
            {months < 6 && exp > 0 && <p className="small ink2">Top up by {fmt.money(Math.max(0, exp * 6 - emergency))} to reach six months. A money market fund pays close to the T-bill rate and can be redeemed in a day or two.</p>}
          </div>
        </Card>
      </div>

      {edit && <GoalModal value={edit} onClose={() => setEdit(null)} onSave={saveGoal} />}
    </div>
  );
}

function GoalModal({ value, onClose, onSave }: { value: Goal; onClose: () => void; onSave: (g: Goal) => void }) {
  const { ws } = useWS();
  const [g, setG] = useState<Goal>(value);
  const [desc, setDesc] = useState('');
  const [ai, setAi] = useState<{ busy: boolean; msg?: string; available?: boolean }>({ busy: false });
  const set = (p: Partial<Goal>) => setG((x) => ({ ...x, ...p }));
  const today = todayISO();

  React.useEffect(() => {
    getSample().then((s) => setAi((a) => ({ ...a, available: !!s })));
  }, []);

  const preset = (k: GoalKind) => {
    const p = GOAL_PRESETS.find((x) => x.kind === k)!;
    set({ kind: k, name: g.name || p.label, inflation: p.inflation, withdraw: p.withdraw, target: p.target, date: addMonthsISO(today, p.years * 12) });
  };

  const fillWithAI = async () => {
    const s = await getSample();
    if (!s || !desc.trim()) return;
    setAi((a) => ({ ...a, busy: true, msg: undefined }));
    try {
      const out = await s.json<Record<string, unknown>>(
        `Turn this savings goal into JSON for a Pakistani investor. Today is ${today}. USD/PKR is ${ws.market.fx.USD}.
Description: """${desc.slice(0, 600)}"""
Return only an object with: name (short), kind (one of retirement, education, home, hajj, wedding, emergency, car, custom), target_todays_pkr (number, today's money; convert lakh/crore and other currencies to PKR), date (YYYY-MM-DD; if only a year is given use 06-30), inflation_pct (yearly cost inflation for this kind of expense in Pakistan: education 10-12, property 8-10, Hajj 8-10, weddings 9-11, general 7-8), priority (high, medium, low), withdraw (true if the money is spent on the date, false for a corpus to keep such as retirement or an emergency fund), estimated (true if you had to estimate the target because the description gives no amount).`,
        opusQuick(),
      );
      const kinds: GoalKind[] = ['retirement', 'education', 'home', 'hajj', 'wedding', 'emergency', 'car', 'custom'];
      const n = (v: unknown) => (isFinite(Number(v)) ? Number(v) : undefined);
      const date = typeof out.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(out.date) ? out.date : g.date;
      set({
        name: typeof out.name === 'string' ? out.name.slice(0, 60) : g.name,
        kind: kinds.includes(out.kind as GoalKind) ? (out.kind as GoalKind) : g.kind,
        target: Math.max(0, n(out.target_todays_pkr) ?? g.target),
        date,
        inflation: Math.max(0, Math.min(30, n(out.inflation_pct) ?? g.inflation)),
        priority: (['high', 'medium', 'low'] as const).includes(out.priority as 'high') ? (out.priority as Goal['priority']) : g.priority,
        withdraw: typeof out.withdraw === 'boolean' ? out.withdraw : g.withdraw,
      });
      setAi((a) => ({ ...a, busy: false, msg: out.estimated ? 'Filled in. The target is an AI estimate, so check it before saving.' : 'Filled in from your description. Check the fields before saving.' }));
    } catch (e) {
      setAi((a) => ({ ...a, busy: false, msg: aiErrorCopy(e) }));
    }
  };

  const months = monthsBetween(today, g.date);
  return (
    <Modal title={value.name ? `Edit ${value.name}` : 'New goal'} onClose={onClose} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={months <= 0 || g.target <= 0} onClick={() => onSave({ ...g, name: g.name.trim() || KIND_LABEL[g.kind] })}>Save goal</Button>
    </>}>
      <div className="stack">
        {ai.available && (
          <div className="card tint" style={{ padding: 12 }}>
            <div className="stack" style={{ gap: 8 }}>
              <label className="small strong" htmlFor="g-desc">Describe it and let AI fill the form</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input id="g-desc" className="input" placeholder="e.g. Umrah for my parents in 2028, about 15 lakh" value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fillWithAI()} />
                <Button variant="ai" icon="sparkle" onClick={fillWithAI} disabled={ai.busy || !desc.trim()}>{ai.busy ? 'Reading…' : 'Fill'}</Button>
              </div>
              {ai.msg && <span className="tiny muted">{ai.msg}</span>}
            </div>
          </div>
        )}
        <div className="row" style={{ gap: 6 }}>
          {GOAL_PRESETS.map((p) => (
            <button key={p.kind} type="button" className="chip" aria-pressed={g.kind === p.kind} onClick={() => preset(p.kind)}>{p.label}</button>
          ))}
        </div>
        <div className="form-grid">
          <Field label="Name" htmlFor="g-name"><input id="g-name" className="input" value={g.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Type" htmlFor="g-kind"><Select id="g-kind" value={g.kind} onChange={(v) => set({ kind: v })} options={(Object.keys(KIND_LABEL) as GoalKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} /></Field>
          <Field label="Target in today’s money" htmlFor="g-target" hint={ws.settings.numberStyle === 'lakh' ? 'Rupees; 1 crore = 1,00,00,000' : 'Rupees'}><NumberInput id="g-target" value={g.target} onChange={(v) => set({ target: Math.max(0, v ?? 0) })} prefix="Rs" groupStyle={ws.settings.numberStyle} step={100000} /></Field>
          <Field label="Date" htmlFor="g-date" hint={months > 0 ? `${(months / 12).toFixed(1)} years from now` : 'Pick a future date'}><input id="g-date" type="date" className="input" value={g.date} min={today} onChange={(e) => set({ date: e.target.value })} /></Field>
          <div className="full"><Slider label="Yearly cost inflation for this goal" value={g.inflation} min={0} max={20} step={0.5} onChange={(v) => set({ inflation: v })} display={`${g.inflation}%`} /></div>
          <Field label="Priority" htmlFor="g-pri"><Select id="g-pri" value={g.priority} onChange={(v) => set({ priority: v })} options={[{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} /></Field>
          <Field label="On the date" htmlFor="g-wd"><Select id="g-wd" value={g.withdraw ? 'yes' : 'no'} onChange={(v) => set({ withdraw: v === 'yes' })} options={[{ value: 'yes', label: 'Spend it (withdraw from portfolio)' }, { value: 'no', label: 'Keep it (a corpus to reach)' }]} /></Field>
        </div>
        <p className="tiny muted">At {g.inflation}% a year, {ws.settings.numberStyle === 'lakh' ? 'this costs' : 'this will cost'} about {fmtPKR(g.target * Math.pow(1 + g.inflation / 100, Math.max(0, months) / 12), ws.settings.numberStyle)} on the date.</p>
      </div>
    </Modal>
  );
}

function fmtPKR(v: number, style: 'lakh' | 'intl'): string {
  return fmtMoney(v, { currency: 'PKR', style, compact: true });
}
