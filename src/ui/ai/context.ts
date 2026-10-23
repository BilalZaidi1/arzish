// Compact portfolio context for AI prompts (kept under ~7 KB).

import { expectedFxChange } from '../../engine/assumptions';
import { CLASS_META, LIQUIDITY_META, TYPE_META } from '../../engine/catalog';
import { fmtDate, fmtMoney, todayISO } from '../../engine/format';
import type { Holding, Portfolio, Workspace } from '../../engine/types';
import { CLASS_ORDER } from '../../engine/types';
import { computeTotals, costPKR, holdingClass, incomeYieldPct, liquidityOf, shariahOf, subLabel, valuePKR } from '../../engine/valuation';
import { PROFILE_LABELS } from '../../engine/optimize';

export function money(v: number, ws: Workspace): string {
  return fmtMoney(v, { currency: 'PKR', style: ws.settings.numberStyle, compact: true });
}

export function marketLine(ws: Workspace): string {
  const m = ws.market;
  return `Market snapshot (dated): KSE-100 ${m.kse100.toLocaleString('en-US')} on ${fmtDate(m.kse100Date)} (${m.kse100Ytd}% in 2026; record ${m.kse100Ath.toLocaleString('en-US')}); SBP policy rate ${m.policyRate}% (${fmtDate(m.policyDate)}); CPI ${m.cpi}% y/y (${m.cpiMonth}), core ${m.coreCpi}%; T-bill cut-offs ${m.tbill.m1}% (1M), ${m.tbill.m3}% (3M), ${m.tbill.m6}% (6M), ${m.tbill.m12}% (12M) on ${fmtDate(m.tbill.date)}; USD/PKR ${m.fx.USD.toFixed(2)} (${fmtDate(m.fxDate)}); gold Rs ${m.goldTola.toLocaleString('en-US')} per tola, silver Rs ${m.silverTola.toLocaleString('en-US')} (${fmtDate(m.goldDate)}); BTC $${m.btcUsd.toLocaleString('en-US')} (${fmtDate(m.btcDate)}); S&P 500 ${m.sp500.toLocaleString('en-US')} (${fmtDate(m.sp500Date)}, ${m.sp500Ytd}% YTD); Fed funds ${m.fedFunds}%, US 10-year ${m.ust10y}%; NSS rates: Behbood/Pensioners ${m.nss.BSC}%, RIC ${m.nss.RIC}%, DSC ${m.nss.DSC}%, SSC ${m.nss.SSC}%, Sarwa Islamic 5y ${m.nss.SITA5}% (${fmtDate(m.nssDate)}).${extraMarket(m)}`;
}

function extraMarket(m: Workspace['market']): string {
  const parts: string[] = [];
  if (m.kibor?.m6) parts.push(`KIBOR offer ${m.kibor.m3 ?? '–'}% (3M), ${m.kibor.m6}% (6M), ${m.kibor.m12 ?? '–'}% (12M) on ${fmtDate(m.kibor.date)}`);
  if (m.fxOpen?.USD) parts.push(`open-market USD ${m.fxOpen.USD.buy}/${m.fxOpen.USD.sell} buy/sell (${fmtDate(m.fxOpenDate)})`);
  if (m.reserves?.total) parts.push(`liquid FX reserves $${(m.reserves.total / 1000).toFixed(1)} bn (${fmtDate(m.reserves.date)})`);
  if (m.ust2y) parts.push(`US 2-year ${m.ust2y}%`);
  if (m.crypto?.ETH) parts.push(`ETH $${Math.round(m.crypto.ETH).toLocaleString('en-US')} (${fmtDate(m.cryptoDate)})`);
  const ix = m.psxIndices;
  if (ix?.rows) {
    const show = ['KSE30', 'KMI30', 'ALLSHR', 'KMIALLSHR'].filter((k) => ix.rows[k]).map((k) => `${k} ${Math.round(ix.rows[k].v).toLocaleString('en-US')}${ix.rows[k].chgPct !== undefined ? ` (${ix.rows[k].chgPct! > 0 ? '+' : ''}${ix.rows[k].chgPct}% on the day)` : ''}`);
    if (show.length) parts.push(`PSX indices ${ix.intraday ? `at ${ix.time} during trading on` : 'at the close of'} ${fmtDate(ix.date)}: ${show.join(', ')}`);
  }
  const psxFed = m.feedAt && !(m.locked ?? []).includes('kse100') && !!ix;
  const head = m.feedAt
    ? ` Rates, FX, gold, NSS, crypto${psxFed ? ', the KSE-100 and PSX share prices' : ''} come from the daily data feed (SBP, CDNS, MUFAP, PSX and others), last applied ${fmtDate(m.asOf)}; ${psxFed ? 'the S&P 500 is' : 'KSE-100 and S&P 500 are'} entered by hand.`
    : '';
  return head + (parts.length ? ` Also: ${parts.join('; ')}.` : '');
}

export function buildContext(ws: Workspace, p: Portfolio, holdings: Holding[] = p.holdings): string {
  const m = ws.market;
  const s = ws.settings;
  const t = computeTotals(holdings, p.liabilities, m);
  const A = t.assets || 1;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`Today: ${fmtDate(todayISO())}.`);
  lines.push(marketLine(ws));
  lines.push(`Investor settings: ${s.filer ? 'filer on the Active Taxpayers List' : 'NON-filer (double withholding rates)'}; base currency ${s.baseCurrency}; number style ${s.numberStyle === 'lakh' ? 'lakh/crore' : 'millions'}; monthly expenses ${money(s.monthlyExpenses, ws)}${s.riskProfile ? `; risk profile ${PROFILE_LABELS[s.riskProfile]}` : ''}; zakat in forecasts ${p.plan.applyZakat ? 'on' : 'off'}.`);
  lines.push(`Portfolio: "${p.name}"${p.isExample ? ' (EXAMPLE portfolio with illustrative prices, not the user\'s real holdings)' : ''}.`);
  lines.push(`Totals: assets ${money(t.assets, ws)}; liabilities ${money(t.liabilities, ws)}; net worth ${money(t.netWorth, ws)} (≈ $${Math.round(t.netWorth / m.fx.USD).toLocaleString('en-US')}); unrealized gain ${t.cost > 0 ? `${money(t.pnl, ws)} (${t.pnlPct.toFixed(1)}%)` : 'n/a'}; cash income ${money(t.income, ws)}/yr (${t.incomeYield.toFixed(2)}% yield, before tax); hard-currency-linked ${pct(t.hardCurrency)}; Shariah-compliant ${pct(t.shariahYes)} (unverified ${pct(t.shariahUnknown)}); liquid within a week ${pct(t.liquidWeek)}.`);
  lines.push(`Allocation by class: ${CLASS_ORDER.filter((c) => t.byClass[c] > 0).map((c) => `${CLASS_META[c].label} ${pct(t.byClass[c] / A)}`).join('; ')}.`);
  const sorted = [...holdings].sort((a, b) => valuePKR(b, m) - valuePKR(a, m));
  lines.push(`Holdings (${holdings.length}; top ${Math.min(30, holdings.length)} by value) — name [ticker] | type | value | weight | gain on cost | cash yield | Shariah | liquidity:`);
  for (const h of sorted.slice(0, 30)) {
    const v = valuePKR(h, m);
    const c = costPKR(h, m);
    lines.push(`- ${h.name}${h.ticker ? ` [${h.ticker}]` : ''} | ${TYPE_META[h.type].label}${h.sub ? ' / ' + subLabel(h) : ''}${h.currency !== 'PKR' ? ` (${h.currency})` : ''} | ${money(v, ws)} | ${pct(v / A)} | ${c ? `${((v / c - 1) * 100).toFixed(1)}%` : 'n/a'} | ${incomeYieldPct(h, m).toFixed(1)}% | ${shariahOf(h)} | ${LIQUIDITY_META[liquidityOf(h)].label}`);
  }
  if (p.liabilities.length) lines.push(`Liabilities: ${p.liabilities.map((l) => `${l.name} ${money(l.balance * (m.fx[l.currency] ?? 1), ws)} at ${l.rate}% (payment ${money(l.payment * (m.fx[l.currency] ?? 1), ws)}/month)`).join('; ')}.`);
  if (p.goals.length) lines.push(`Goals: ${p.goals.map((g) => `${g.name} — ${money(g.target, ws)} in today's money by ${fmtDate(g.date)}, cost inflation ${g.inflation}%/yr, ${g.withdraw ? 'withdrawn on the date' : 'a corpus to reach'}, ${g.priority} priority`).join('; ')}.`);
  const pl = p.plan;
  lines.push(`Plan: SIP ${money(pl.sipMonthly, ws)}/month rising ${pl.sipStepUp}%/yr; horizon ${pl.horizonYears} years; contributions follow the ${pl.contributionMix === 'target' ? 'target mix' : 'current mix'}; rebalancing ${pl.rebalance === 'none' ? 'none' : pl.rebalance === 'annual_current' ? 'yearly to current weights' : 'yearly to target mix'}; income ${pl.reinvestIncome ? 'reinvested' : 'paid out'}; taxes ${pl.applyTax ? 'applied' : 'ignored'}${pl.retirement.enabled ? `; retirement drawdown from age ${pl.retirement.retireAge} (now ${pl.retirement.age}) of ${money(pl.retirement.monthlyNeed, ws)}/month in today's money less pension ${money(pl.retirement.pension, ws)}` : ''}.${p.targetMix ? ` Target mix: ${Object.entries(p.targetMix).map(([k, v]) => `${k} ${v}%`).join(', ')}.` : ''}`);
  const a = ws.assumptions;
  lines.push(`Model assumptions (median CAGR / volatility): PSX ${a.factors.psx.cagr}%/${a.factors.psx.vol}% PKR; global equities ${a.factors.gleq.cagr}%/${a.factors.gleq.vol}% USD; USD bonds ${a.factors.glbond.cagr}%/${a.factors.glbond.vol}%; gold ${a.factors.gold.cagr}%/${a.factors.gold.vol}% USD; Pakistan property ${a.factors.re.cagr}%/${a.factors.re.vol}% plus rent; crypto ${a.factors.crypto.cagr}%/${a.factors.crypto.vol}% USD; USD/PKR expected +${expectedFxChange(a).toFixed(1)}%/yr with a ${a.macro.jumpProb}% yearly chance of a ${a.macro.jumpSize}% devaluation; PKR short rate ${a.macro.rate0}% → ${a.macro.rateLR}%; CPI ${a.macro.cpi0}% → ${a.macro.cpiLR}%.`);
  return lines.join('\n');
}

export const ANALYST_RULES = `You are Arzish Analyst, the AI analyst inside Arzish, a Pakistan-first portfolio forecasting app used by PSX, mutual fund, National Savings, property, gold, global-market and crypto investors.

How to work:
- Ground every number in the portfolio context below or in tool results. Never invent prices, NAVs, returns, rates or holdings. If data is missing, stale or an example, say so plainly.
- Use the tools for calculations: run_forecast for projections and goal odds, run_stress_test for shocks, get_risk_report for risk, optimize_allocation for target mixes, solve_required_sip for "how much should I invest" questions. Make the fewest calls that answer the question; never repeat a call with identical inputs.
- When a chart would make the answer clearer, call render_chart with numbers you got from tools or the context (at most 8 series and 40 points). Do not describe a chart you did not draw.
- Money in Pakistani style (Rs 12.5 lakh, Rs 2.35 Cr) unless the user prefers millions; give USD where it helps.
- Style: lead with the answer in one or two sentences, then the specifics. Bullets for lists, a small table for comparisons. Name weaknesses directly: concentration, rupee exposure, inflation drag, liquidity, tax leakage. Keep it under 350 words unless asked for a full review.
- Scope: this is educational analysis, not licensed investment advice. Do not promise returns and do not tell the user to buy or sell a specific security; recommend asset-class or product-type changes and what to verify. Tax and zakat figures are estimates under TY2027 rules.
- Forecasts are probabilistic: quote medians with a P10–P90 range, and say "in today's money" when using real values.`;
