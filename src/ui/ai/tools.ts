// Page functions the AI analyst can call. Results are small, rounded JSON.

import { CLASS_META, LIQUIDITY_META, TYPE_META } from '../../engine/catalog';
import { buildSim, type BuildOptions } from '../../engine/exposures';
import { todayISO } from '../../engine/format';
import { buildClassSim, classStats, currentMix, efficientFrontier, MODEL_PORTFOLIOS, OPT_LABELS, portStats, rebalanceTrades } from '../../engine/optimize';
import { analyzeRisk, buildRiskSim, concentration } from '../../engine/risk';
import { hitRate, solveRequiredSip } from '../../engine/simulate';
import { runStress, STRESS_PRESETS } from '../../engine/stress';
import { TAX } from '../../engine/tax';
import type { ChartSpec, Holding, OptClass, Portfolio, RiskProfile, Shocks, Workspace } from '../../engine/types';
import { CLASS_ORDER, OPT_CLASSES } from '../../engine/types';
import { computeTotals, costPKR, holdingClass, incomeYieldPct, liquidityOf, sectorOf, shariahOf, valuePKR } from '../../engine/valuation';
import type { SampleTool } from '../../state/claude';
import { runSim } from '../../state/simClient';
import type { View } from '../../state/store';
import { VIEWS } from '../../state/store';
import { normalizeHolding } from './normalize';
import { sanitizeSpec } from './SpecChart';

export interface ToolEnv {
  get: () => { ws: Workspace; active: Portfolio };
  onChart: (spec: ChartSpec) => void;
  onNavigate: (v: View) => void;
  onStage: (h: Holding[]) => void;
  onProgress: (label: string, done?: boolean) => void;
}

const R = (v: number, d = 0) => {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
};
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return isFinite(n) ? n : undefined;
};

function parseMix(v: unknown): Partial<Record<OptClass, number>> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const out: Partial<Record<OptClass, number>> = {};
  let any = false;
  for (const c of OPT_CLASSES) {
    const n = num(o[c]);
    if (n !== undefined && n >= 0) {
      out[c] = n;
      any = true;
    }
  }
  return any ? out : undefined;
}

const MIX_SCHEMA = {
  type: 'object',
  description: 'Percent weights by class: pkfi (PKR fixed income/cash), psx (PSX equities), gleq (global equities), gold, usd (USD cash/bonds), crypto. Property is held fixed.',
  properties: Object.fromEntries(OPT_CLASSES.map((c) => [c, { type: 'number' }])),
};

const SHOCK_KEYS = ['psx', 'gleq', 'glbond', 'gold', 're', 'crypto', 'fx', 'rate', 'cpi'] as const;

export function buildTools(env: ToolEnv): SampleTool[] {
  const tools: SampleTool[] = [
    {
      name: 'run_forecast',
      description: 'Monte Carlo forecast of the active portfolio with its goals, SIP and taxes. Optional overrides test what-ifs. Returns P10/median/P90 net worth (PKR, nominal and in today\'s money, plus USD) at key years, median CAGR, goal probabilities and first-year loss probability.',
      inputSchema: {
        type: 'object',
        properties: {
          years: { type: 'number', description: 'Horizon in years (1-40). Default: the plan horizon.' },
          monthly_sip: { type: 'number', description: 'Monthly investment in PKR. Default: current plan.' },
          sip_step_up_pct: { type: 'number', description: 'Yearly increase of the SIP, %.' },
          extra_monthly_withdrawal: { type: 'number', description: 'Extra monthly withdrawal in today\'s PKR, inflation-indexed.' },
          target_mix: MIX_SCHEMA,
          rebalance: { type: 'string', enum: ['none', 'annual_current', 'annual_target'] },
        },
      },
      async execute(input) {
        env.onProgress('Running forecast');
        const { ws, active } = env.get();
        const mix = parseMix(input.target_mix);
        const years = Math.max(1, Math.min(40, num(input.years) ?? active.plan.horizonYears));
        const opts: BuildOptions = {
          horizonYears: years,
          paths: 1500,
          sipMonthly: num(input.monthly_sip),
          sipStepUp: num(input.sip_step_up_pct),
          extraWithdrawalMonthly: num(input.extra_monthly_withdrawal),
          mixOverride: mix,
          contributionMix: mix ? 'target' : undefined,
          rebalance: (['none', 'annual_current', 'annual_target'] as const).includes(input.rebalance as 'none') ? (input.rebalance as BuildOptions['rebalance']) : mix ? 'annual_target' : undefined,
          perClass: false,
          trackIncome: true,
        };
        const built = buildSim(active, active.holdings, ws, opts);
        const res = await runSim(built.input);
        env.onProgress('Running forecast', true);
        const startYear = Number(todayISO().slice(0, 4));
        const H = res.points.length - 1;
        const idx = Array.from(new Set([1, 3, 5, 10, 15, 20, 25, 30, 40].filter((y) => y * 12 <= res.months).map((y) => y).concat([Math.round(res.points[H] / 12)])));
        return {
          start_net_worth_pkr: R(res.nominal[3][0]),
          horizon_year: startYear + Math.round(res.points[H] / 12),
          monthly_sip_pkr: R(opts.sipMonthly ?? active.plan.sipMonthly),
          points: idx.map((y) => {
            const k = Math.min(H, y);
            return { year: startYear + y, p10_pkr: R(res.nominal[1][k]), median_pkr: R(res.nominal[3][k]), p90_pkr: R(res.nominal[5][k]), median_todays_money_pkr: R(res.real[3][k]), median_usd: R(res.usd[3][k]) };
          }),
          median_cagr_pct: R(res.twrCagrPct[1], 1),
          cagr_p10_p90_pct: [R(res.twrCagrPct[0], 1), R(res.twrCagrPct[2], 1)],
          prob_beats_inflation_pct: R(res.realTwrPositive * 100),
          prob_loss_first_year_pct: R(res.probLoss1y * 100),
          max_drawdown_median_pct: R(res.maxDD.median * 100),
          max_drawdown_p90_pct: R(res.maxDD.p90 * 100),
          annual_income_median_pkr_at_horizon: res.incomePct.length ? R(res.incomePct[3][H]) : undefined,
          goals: res.goals.map((g) => ({ name: active.goals.find((x) => x.id === g.id)?.name, prob_pct: R(g.prob * 100), target_at_date_pkr: R(g.targetNominal) })),
          median_usdpkr_at_horizon: R(res.fxPct[3][H], 1),
          paths: res.paths,
        };
      },
    },
    {
      name: 'run_stress_test',
      description: `Instant stress test on current holdings. Use a preset key (${STRESS_PRESETS.map((s) => s.key).join(', ')}) or custom shocks. Shocks: psx, gleq, glbond, gold (USD), re, crypto and fx (USD/PKR) as % changes; rate and cpi in percentage points. Returns the PKR and USD impact, by class and worst holdings.`,
      inputSchema: {
        type: 'object',
        properties: {
          preset: { type: 'string', enum: STRESS_PRESETS.map((s) => s.key) },
          name: { type: 'string' },
          shocks: { type: 'object', properties: Object.fromEntries(SHOCK_KEYS.map((k) => [k, { type: 'number' }])) },
        },
      },
      execute(input) {
        const { ws, active } = env.get();
        const preset = STRESS_PRESETS.find((s) => s.key === input.preset);
        const shocks: Shocks = {};
        const src = (input.shocks ?? preset?.shocks ?? {}) as Record<string, unknown>;
        for (const k of SHOCK_KEYS) {
          const n = num(src[k]);
          if (n !== undefined) shocks[k] = Math.max(-100, Math.min(300, n));
        }
        const r = runStress(active.holdings, active.liabilities, ws.market, shocks);
        const fx = (shocks.fx ?? 0) / 100;
        return {
          scenario: preset?.name ?? String(input.name ?? 'Custom scenario'),
          shocks,
          net_worth_before_pkr: R(r.before),
          change_pkr: R(r.change),
          change_pct: R(r.changePct, 1),
          change_in_usd_terms_pct: R(((1 + r.changePct / 100) / (1 + fx) - 1) * 100, 1),
          by_class: r.byClass.map((c) => ({ class: CLASS_META[c.cls].label, change_pkr: R(c.change), change_pct: c.before ? R((c.change / c.before) * 100, 1) : 0 })),
          worst_holdings: r.holdings.slice(0, 6).map((h) => ({ name: h.name, change_pkr: R(h.change), change_pct: R(h.pct * 100, 1) })),
        };
      },
    },
    {
      name: 'get_risk_report',
      description: 'One-year risk of current holdings from 5,000 simulations: expected return, volatility, 95% VaR and CVaR, probability of loss, Sharpe vs T-bills, beta to KSE-100 and S&P 500 (PKR), risk contribution by class, the riskiest holdings and concentration.',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        env.onProgress('Measuring risk');
        const { ws, active } = env.get();
        const rb = buildRiskSim(active, active.holdings, ws, 5000, 12);
        const res = await runSim(rb.input);
        const r = analyzeRisk(rb, res, ws.market.tbill.m12, ws.market.cpi);
        const conc = concentration(active.holdings, ws.market, sectorOf);
        env.onProgress('Measuring risk', true);
        return {
          expected_return_1y_pct: R(r.mean * 100, 1),
          volatility_pct: R(r.sd * 100, 1),
          var95_pct: R(r.var95 * 100, 1),
          var95_pkr: R(r.var95 * r.total),
          cvar95_pct: R(r.cvar95 * 100, 1),
          prob_loss_pct: R(r.probLoss * 100),
          prob_below_inflation_pct: R(r.probBelowInflation * 100),
          sharpe_vs_tbill: R(r.sharpe, 2),
          beta_kse100: R(r.betaKse, 2),
          beta_sp500_pkr: R(r.betaSpx, 2),
          risk_by_class: r.classes.map((c) => ({ class: CLASS_META[c.cls].label, weight_pct: R(c.weight * 100, 1), risk_contribution_pct: R(c.riskContrib * 100, 1), vol_pct: R(c.vol * 100, 1) })),
          riskiest_holdings: r.top.slice(0, 6).map((t) => ({ name: t.name, weight_pct: R(t.weight * 100, 1), risk_contribution_pct: R(t.riskContrib * 100, 1) })),
          concentration: { top_holding: conc.top1?.name, top_holding_pct: conc.top1 ? R(conc.top1.weight * 100, 1) : 0, top5_pct: R(conc.top5 * 100, 1), effective_number_of_holdings: R(conc.effectiveN, 1), top_psx_sector: conc.topSector?.name, top_psx_sector_pct: conc.topSector ? R(conc.topSector.weight * 100, 1) : undefined },
        };
      },
    },
    {
      name: 'optimize_allocation',
      description: 'Class-level mean-variance optimisation for the liquid part of the portfolio (property and locked assets stay as they are). Give a risk profile to use its model mix, or bounds to find the max-Sharpe mix. Returns current vs recommended mix, expected return and volatility, and the rebalancing trades with estimated CGT.',
      inputSchema: {
        type: 'object',
        properties: {
          profile: { type: 'string', enum: ['conservative', 'moderate', 'balanced', 'growth', 'aggressive'] },
          max_crypto_pct: { type: 'number' },
          min_pkfi_pct: { type: 'number' },
          max_single_class_pct: { type: 'number' },
        },
      },
      async execute(input) {
        env.onProgress('Optimising mix');
        const { ws, active } = env.get();
        const res = await runSim(buildClassSim(ws.assumptions, ws.market, 6000));
        const st = classStats(res);
        const maxC = (num(input.max_crypto_pct) ?? 5) / 100;
        const minF = (num(input.min_pkfi_pct) ?? 5) / 100;
        const maxS = (num(input.max_single_class_pct) ?? 60) / 100;
        const lb = OPT_CLASSES.map((c) => (c === 'pkfi' ? minF : 0));
        const ub = OPT_CLASSES.map((c) => (c === 'crypto' ? maxC : maxS));
        const fr = efficientFrontier(st, lb, ub, ws.market.tbill.m12 / 100);
        const profile = input.profile as RiskProfile | undefined;
        const target = profile && MODEL_PORTFOLIOS[profile] ? MODEL_PORTFOLIOS[profile] : Object.fromEntries(OPT_CLASSES.map((c, i) => [c, R(fr.maxSharpe.w[i] * 100, 1)])) as Record<OptClass, number>;
        const mix = currentMix(active.holdings, ws.market);
        const tw = OPT_CLASSES.map((c) => (target[c] ?? 0) / 100);
        const cur = portStats(mix.weights, st);
        const rec = portStats(tw, st);
        const trades = rebalanceTrades(active.holdings, mix, target, ws.market, ws.settings, todayISO());
        env.onProgress('Optimising mix', true);
        return {
          basis: profile ? `${profile} model portfolio` : 'maximum Sharpe ratio within bounds',
          liquid_value_optimised_pkr: R(mix.total),
          locked_value_unchanged_pkr: R(mix.locked),
          classes: OPT_CLASSES.map((c, i) => ({ class: OPT_LABELS[c], key: c, current_pct: R(mix.weights[i] * 100, 1), recommended_pct: R(tw[i] * 100, 1), trade_pkr: R(trades.trades[i].trade) })),
          current: { expected_return_pct: R(cur.ret * 100, 1), volatility_pct: R(cur.vol * 100, 1) },
          recommended: { expected_return_pct: R(rec.ret * 100, 1), volatility_pct: R(rec.vol * 100, 1) },
          estimated_cgt_on_sales_pkr: R(trades.totalTax),
          note: 'Expected returns are one-year arithmetic means in PKR from the app assumptions.',
        };
      },
    },
    {
      name: 'solve_required_sip',
      description: 'Exact monthly SIP needed so the portfolio (excluding property, net of debt) reaches a target with a chosen probability, keeping the current yearly step-up. Target is in today\'s PKR and grows with the given inflation.',
      inputSchema: {
        type: 'object',
        properties: {
          target_todays_pkr: { type: 'number' },
          years: { type: 'number' },
          probability_pct: { type: 'number', description: 'Default 80' },
          inflation_pct: { type: 'number', description: 'Default: long-run CPI assumption' },
        },
        required: ['target_todays_pkr', 'years'],
      },
      async execute(input) {
        env.onProgress('Solving SIP');
        const { ws, active } = env.get();
        const target = num(input.target_todays_pkr);
        const years = Math.max(1, Math.min(40, num(input.years) ?? 10));
        if (!target || target <= 0) throw new Error('target_todays_pkr must be a positive number');
        const p = Math.max(0.05, Math.min(0.99, (num(input.probability_pct) ?? 80) / 100));
        const infl = num(input.inflation_pct) ?? ws.assumptions.macro.cpiLR;
        const opts = { horizonYears: years, paths: 2000, includeGoals: false, includeRetirement: false, perClass: false, trackIncome: false };
        const built = buildSim(active, active.holdings, ws, opts);
        const res = await runSim(built.input);
        const k = built.horizonKeep;
        const tNom = target * Math.pow(1 + infl / 100, years);
        const solved = await solveRequiredSip({ values: res.keepValues[k], units: res.keepUnits[k] }, tNom, p, async (x) => {
          const rr = await runSim(buildSim(active, active.holdings, ws, { ...opts, sipMonthly: active.plan.sipMonthly + x }).input);
          return { values: rr.keepValues[k], units: rr.keepUnits[k] };
        }, 2);
        const extra = solved.extra;
        const now = hitRate(res.keepValues[k], tNom);
        env.onProgress('Solving SIP', true);
        return {
          target_at_date_pkr: R(tNom),
          years,
          probability_target_pct: R(p * 100),
          probability_with_current_plan_pct: R(now * 100),
          probability_with_solved_sip_pct: isFinite(extra) && extra > 0 ? R(solved.prob * 100) : undefined,
          current_monthly_sip_pkr: R(active.plan.sipMonthly),
          extra_monthly_sip_needed_pkr: isFinite(extra) ? R(Math.max(0, extra)) : null,
          total_monthly_sip_pkr: isFinite(extra) ? R(active.plan.sipMonthly + Math.max(0, extra)) : null,
          step_up_pct: active.plan.sipStepUp,
        };
      },
    },
    {
      name: 'render_chart',
      description: 'Draw a chart in the conversation in the app\'s style. Use data from tools or the context only. type: line | bar | stacked_bar | hbar | area | scatter | heatmap | fan (fan = three series named P10, Median, P90). Up to 8 series, 40 points.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['line', 'bar', 'stacked_bar', 'hbar', 'area', 'scatter', 'heatmap', 'fan'] },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          x: { type: 'object', properties: { label: { type: 'string' }, categories: { type: 'array', items: { type: ['string', 'number'] } } } },
          y: { type: 'object', properties: { label: { type: 'string' }, unit: { type: 'string', enum: ['PKR', 'USD', '%', 'number'] } } },
          series: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, data: { type: 'array' } } } },
          heat: { type: 'object', properties: { rows: { type: 'array' }, cols: { type: 'array' }, values: { type: 'array' } } },
          note: { type: 'string' },
        },
        required: ['type', 'title'],
      },
      execute(input) {
        const spec = sanitizeSpec(input);
        if (!spec) throw new Error('The chart needs a type, a title and at least one series with numeric data.');
        env.onChart(spec);
        return 'Chart shown to the user.';
      },
    },
    {
      name: 'get_holdings',
      description: 'List holdings with value, weight, gain, yield, Shariah status and liquidity. Optional filter by asset class.',
      inputSchema: { type: 'object', properties: { asset_class: { type: 'string', enum: CLASS_ORDER as unknown as string[] } } },
      execute(input) {
        const { ws, active } = env.get();
        const t = computeTotals(active.holdings, active.liabilities, ws.market);
        return active.holdings
          .filter((h) => !input.asset_class || holdingClass(h) === input.asset_class)
          .map((h) => {
            const v = valuePKR(h, ws.market);
            const c = costPKR(h, ws.market);
            return { name: h.name, ticker: h.ticker, type: TYPE_META[h.type].label, class: CLASS_META[holdingClass(h)].label, currency: h.currency, value_pkr: R(v), weight_pct: R((v / (t.assets || 1)) * 100, 1), gain_pct: c ? R((v / c - 1) * 100, 1) : null, cash_yield_pct: R(incomeYieldPct(h, ws.market), 1), shariah: shariahOf(h), liquidity: LIQUIDITY_META[liquidityOf(h)].label };
          })
          .sort((a, b) => b.value_pkr - a.value_pkr)
          .slice(0, 60);
      },
    },
    {
      name: 'get_tax_rates',
      description: 'TY2027 Pakistan tax rates used by the app (filer / non-filer) for dividends, profit on debt, capital gains and property transactions.',
      inputSchema: { type: 'object', properties: {} },
      execute() {
        return {
          tax_year: 'TY2027 (July 2026 to June 2027)',
          dividends_pct: [TAX.dividend * 100, TAX.dividend * 200],
          fund_dividend_debt_portion_pct: [TAX.fundDebtDividend * 100, TAX.fundDebtDividend * 200],
          bank_profit_pct: [TAX.bankProfit * 100, TAX.bankProfit * 200],
          nss_and_govt_securities_profit_pct: [TAX.nssProfit * 100, TAX.nssProfit * 200],
          cgt_listed_shares_bought_from_jul_2024_pct: [15, 'higher, slab-based'],
          cgt_mutual_fund_units_pct: [15, 'higher'],
          property_seller_236C_pct: [2.75, 11.5],
          property_buyer_236K_pct: [1.25, '10.5 to 18.5 by value'],
          cgt_property_bought_from_jul_2024_pct: [15, 'higher'],
          zakat_pct: 2.5,
          note: 'Format is [filer, non-filer]. Estimates; confirm with a tax adviser.',
        };
      },
    },
    {
      name: 'open_screen',
      description: 'Open a screen of the app for the user, for example after an answer that the screen explains in more detail.',
      inputSchema: { type: 'object', properties: { screen: { type: 'string', enum: VIEWS as unknown as string[] } }, required: ['screen'] },
      execute(input) {
        const v = String(input.screen) as View;
        if (!VIEWS.includes(v)) throw new Error('Unknown screen');
        env.onNavigate(v);
        return `Opened the ${v} screen.`;
      },
    },
    {
      name: 'get_portfolio_summary',
      description: 'Totals of the active portfolio: assets, liabilities, net worth, unrealized gain, income and yield, allocation by class and by currency, hard-currency share, Shariah share, liquidity, and the investor profile settings.',
      inputSchema: { type: 'object', properties: {} },
      execute() {
        const { ws, active } = env.get();
        const t = computeTotals(active.holdings, active.liabilities, ws.market);
        const A = t.assets || 1;
        const byCur: Record<string, number> = {};
        active.holdings.forEach((h) => (byCur[h.currency] = (byCur[h.currency] ?? 0) + valuePKR(h, ws.market)));
        return {
          name: active.name,
          is_example: !!active.isExample,
          assets_pkr: R(t.assets),
          liabilities_pkr: R(t.liabilities),
          net_worth_pkr: R(t.netWorth),
          net_worth_usd: R(t.netWorth / ws.market.fx.USD),
          unrealized_gain_pkr: t.cost > 0 ? R(t.pnl) : null,
          unrealized_gain_pct: t.cost > 0 ? R(t.pnlPct, 1) : null,
          cash_income_pkr_per_year: R(t.income),
          income_yield_pct: R(t.incomeYield, 2),
          allocation_by_class_pct: Object.fromEntries(CLASS_ORDER.filter((c) => t.byClass[c] > 0).map((c) => [CLASS_META[c].label, R((t.byClass[c] / A) * 100, 1)])),
          allocation_by_currency_pct: Object.fromEntries(Object.entries(byCur).map(([c, v]) => [c, R((v / A) * 100, 1)])),
          hard_currency_linked_pct: R(t.hardCurrency * 100, 1),
          shariah_compliant_pct: R(t.shariahYes * 100, 1),
          liquid_within_a_week_pct: R(t.liquidWeek * 100, 1),
          holdings_count: t.count,
          settings: { filer: ws.settings.filer, base_currency: ws.settings.baseCurrency, monthly_expenses_pkr: ws.settings.monthlyExpenses, risk_profile: ws.settings.riskProfile ?? null, age: ws.settings.age ?? null },
        };
      },
    },
    {
      name: 'get_assumptions',
      description: 'Forecast assumptions in use: median yearly return and volatility per market, Pakistan macro path (short rate, CPI, USD/PKR drift and devaluation jumps), key correlations and the market snapshot date.',
      inputSchema: { type: 'object', properties: {} },
      execute() {
        const { ws } = env.get();
        const a = ws.assumptions;
        const order = ['psx', 'gleq', 'glbond', 'gold', 're', 'crypto', 'fx', 'rate', 'cpi'];
        const pairs: [number, number][] = [[0, 6], [0, 1], [6, 8], [7, 8], [1, 5], [3, 2], [0, 7], [4, 8]];
        return {
          markets: Object.fromEntries(Object.entries(a.factors).map(([k, v]) => [k, { median_return_pct: v.cagr, volatility_pct: v.vol }])),
          macro: a.macro,
          key_correlations: pairs.map(([i, j]) => ({ pair: `${order[i]} vs ${order[j]}`, value: R(a.corr[i][j], 2) })),
          assumptions_as_of: a.asOf,
          market_snapshot_as_of: ws.market.asOf,
        };
      },
    },
    {
      name: 'stage_holdings',
      description: 'Put holdings the user described into a review tray so they can confirm adding them. Never adds anything by itself. Each holding: type, name, ticker, sub, currency, qty, unit, price, amount, avgCost, purchaseDate, rate, maturity, karat, account. Use null for unknown prices; never invent them.',
      inputSchema: { type: 'object', properties: { holdings: { type: 'array', items: { type: 'object' } } }, required: ['holdings'] },
      execute(input) {
        const { ws } = env.get();
        const list = (Array.isArray(input.holdings) ? input.holdings : []).map((r) => normalizeHolding(r, ws.market)).filter((h): h is Holding => !!h).slice(0, 50);
        if (!list.length) throw new Error('No valid holdings: each needs a type or name and a quantity or amount.');
        env.onStage(list);
        return { staged: list.length, note: 'Shown to the user for confirmation; not yet added.' };
      },
    },
  ];
  // If the viewer allows fewer tools than we define, keep the most useful ones.
  const PRIORITY = ['run_forecast', 'run_stress_test', 'get_risk_report', 'render_chart', 'solve_required_sip', 'optimize_allocation', 'stage_holdings', 'get_holdings', 'get_tax_rates', 'open_screen', 'get_portfolio_summary', 'get_assumptions'];
  return tools.sort((a, b) => PRIORITY.indexOf(a.name) - PRIORITY.indexOf(b.name));
}

export const TOOL_LABELS: Record<string, string> = {
  run_forecast: 'Ran a forecast',
  run_stress_test: 'Ran a stress test',
  get_risk_report: 'Measured risk',
  optimize_allocation: 'Optimised the mix',
  solve_required_sip: 'Solved the SIP',
  render_chart: 'Drew a chart',
  get_holdings: 'Read holdings',
  get_tax_rates: 'Read tax rates',
  open_screen: 'Opened a screen',
  stage_holdings: 'Prepared holdings',
  get_portfolio_summary: 'Read the summary',
  get_assumptions: 'Read assumptions',
};
