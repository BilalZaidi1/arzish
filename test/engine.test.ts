// Engine checks: run with `node test/run-engine-tests.mjs`.
import { DEFAULT_ASSUMPTIONS, DEFAULT_CORR, DEFAULT_MARKET } from '../src/engine/assumptions';
import { buildSim } from '../src/engine/exposures';
import { cholesky, safeCholesky } from '../src/engine/linalg';
import { analyzeRisk, buildRiskSim } from '../src/engine/risk';
import { hitRate, requiredExtraSip, simulate, solveRequiredSip } from '../src/engine/simulate';
import { createWorkspace, defaultPlan, emptyPortfolio } from '../src/engine/samples';
import { runStress, STRESS_PRESETS } from '../src/engine/stress';
import { buildClassSim, classStats, efficientFrontier, currentMix } from '../src/engine/optimize';
import { computeTotals } from '../src/engine/valuation';
import { fmtMoney, groupLakh } from '../src/engine/format';
import { backtest } from '../src/engine/history';
import type { Assumptions, Holding, Portfolio } from '../src/engine/types';
import { incomeLines } from '../src/engine/income';
import { computeZakat, rentTax } from '../src/engine/tax';
import { applyFeed, applyFundNavs, applyPsxPrices, categoryFromMufap, companyName, matchFund, parsePsx, searchPsx, sectorFromPsx, type FeedDoc, type FundsDoc, type PsxDoc } from '../src/engine/feed';
import { unitPrice } from '../src/engine/valuation';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
}
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// 1. Correlation matrix is positive definite
check('default correlation matrix is positive definite', cholesky(DEFAULT_CORR) !== null);
const bad = DEFAULT_CORR.map((r) => r.slice());
bad[0][1] = bad[1][0] = 0.99; bad[0][6] = bad[6][0] = 0.99; bad[1][6] = bad[6][1] = -0.99;
const rep = safeCholesky(bad);
check('broken matrix gets repaired', rep.repaired && cholesky(rep.matrix) !== null);

// 2. Zero-volatility compounding
function zeroVolAssumptions(): Assumptions {
  const a: Assumptions = JSON.parse(JSON.stringify(DEFAULT_ASSUMPTIONS));
  for (const k of Object.keys(a.factors) as (keyof Assumptions['factors'])[]) a.factors[k].vol = 0;
  a.macro.rateVol = 0; a.macro.cpiVol = 0; a.macro.fxVol = 0; a.macro.jumpProb = 0;
  a.macro.rate0 = a.macro.rateLR; a.macro.cpi0 = a.macro.cpiLR;
  return a;
}
const ws = createWorkspace();
const za = zeroVolAssumptions();
const p0: Portfolio = { ...emptyPortfolio('t'), plan: defaultPlan({ sipMonthly: 0, horizonYears: 10, applyTax: false }) };
const hCustom: Holding = { id: 'c1', type: 'custom', name: 'Custom 10%', currency: 'PKR', qty: 1, price: 1_000_000, expReturn: 10, vol: 0 };
{
  const b = buildSim(p0, [hCustom], { ...ws, assumptions: za }, { paths: 10, includeGoals: false, includeRetirement: false });
  const r = simulate(b.input);
  const expected = 1_000_000 * Math.pow(1.1, 10);
  check('zero-vol 10% for 10 years matches closed form', close(r.nominal[3][10], expected, 0.001), `${r.nominal[3][10].toFixed(0)} vs ${expected.toFixed(0)}`);
  const realExp = expected / Math.pow(1 + za.macro.cpiLR / 100 / 12, 120);
  check('real value deflates by CPI', close(r.real[3][10], realExp, 0.001), `${r.real[3][10].toFixed(0)} vs ${realExp.toFixed(0)}`);
}
// 3. SIP accumulation with cash
{
  const hCash: Holding = { id: 'k', type: 'deposit', sub: 'current', name: 'Current account', currency: 'PKR', qty: 1, price: 1, rate: 0 };
  const p = { ...p0, plan: defaultPlan({ sipMonthly: 10_000, sipStepUp: 0, horizonYears: 2, applyTax: false }) };
  const b = buildSim(p, [hCash], { ...ws, assumptions: za }, { paths: 5, includeGoals: false, includeRetirement: false });
  const r = simulate(b.input);
  check('SIP into zero-return cash sums contributions', close(r.nominal[3][2], 240_001, 1e-9), r.nominal[3][2].toFixed(2));
  check('contributions tracked', close(r.contribCum[2], 240_000, 1e-9));
}
// 4. FX: USD asset with zero local return grows with expected depreciation
{
  const a = zeroVolAssumptions();
  const h: Holding = { id: 'u', type: 'fx_cash', name: 'USD', sub: 'cash', currency: 'USD', qty: 1, price: 1000, rate: 0 };
  const b = buildSim(p0, [h], { ...ws, assumptions: a }, { paths: 5, includeGoals: false, includeRetirement: false });
  const r = simulate(b.input);
  const expected = 1000 * ws.market.fx.USD * Math.pow(1 + a.macro.fxDrift / 100, 10);
  check('USD cash follows USD/PKR drift', close(r.nominal[3][10], expected, 0.002), `${r.nominal[3][10].toFixed(0)} vs ${expected.toFixed(0)}`);
  check('USD value stays flat in USD', close(r.usd[3][10], 1000, 0.002), r.usd[3][10].toFixed(2));
}

// 5. Example portfolio forecast and timing
const ex = ws.portfolios[0];
const totals = computeTotals(ex.holdings, ex.liabilities, ws.market);
console.log('Example net worth', fmtMoney(totals.netWorth, { compact: true }), 'assets', fmtMoney(totals.assets, { compact: true }), 'income yield', totals.incomeYield.toFixed(2) + '%');
{
  const b = buildSim(ex, ex.holdings, ws, {});
  const r = simulate(b.input);
  console.log(`Forecast ${b.input.paths} paths × ${b.months} months × ${b.input.assets.length} assets: ${r.elapsedMs.toFixed(0)} ms`);
  const H = r.points.length - 1;
  console.log('Start', fmtMoney(r.nominal[3][0], { compact: true }), 'horizon P10/P50/P90', [1, 3, 5].map((i) => fmtMoney(r.nominal[i][H], { compact: true })).join(' / '));
  console.log('Real P50', fmtMoney(r.real[3][H], { compact: true }), 'USD P50', fmtMoney(r.usd[3][H], { currency: 'USD', compact: true }));
  console.log('TWR CAGR p10/p50/p90', r.twrCagrPct.map((x) => x.toFixed(1)).join(' / '), 'prob loss 1y', r.probLoss1y.toFixed(3), 'maxDD', r.maxDD.median.toFixed(3), r.maxDD.p90.toFixed(3));
  console.log('Goals', r.goals.map((g) => `${g.id.slice(0, 6)} ${(g.prob * 100).toFixed(0)}% (target ${fmtMoney(g.targetNominal, { compact: true })})`).join('; '));
  console.log('Median CPI at horizon', r.cpiPct[3][H].toFixed(2), 'USD/PKR', r.fxPct[3][H].toFixed(1), 'rate', (r.ratePct[3][H] * 100).toFixed(1));
  check('forecast under 2.5 s', r.elapsedMs < 2500, `${r.elapsedMs.toFixed(0)} ms`);
  check('percentiles ordered', r.nominal[1][H] < r.nominal[3][H] && r.nominal[3][H] < r.nominal[5][H]);
  const classSum = r.classCentral.reduce((s, c) => s + c[H], 0);
  console.log('central composition sum', fmtMoney(classSum, { compact: true }));

  // SIP solver: required extra SIP for the horizon target, then verify by re-simulating.
  // a) Linear case (no goal withdrawals): the one-shot solution is exact.
  {
    const bl = buildSim(ex, ex.holdings, ws, { includeGoals: false, includeRetirement: false });
    const rl = simulate(bl.input);
    const kl = bl.horizonKeep;
    const tgt = rl.nominal[3][rl.points.length - 1] * 1.25;
    const x = requiredExtraSip(rl.keepValues[kl], rl.keepUnits[kl], tgt, 0.8);
    const rr = simulate(buildSim(ex, ex.holdings, ws, { includeGoals: false, includeRetirement: false, sipMonthly: ex.plan.sipMonthly + x }).input);
    const pr = hitRate(rr.keepValues[kl], tgt);
    check('linear SIP solve hits 80% within 2 points', Math.abs(pr - 0.8) <= 0.02, `extra ${fmtMoney(x, { compact: true })}/mo → ${(pr * 100).toFixed(1)}%`);
  }
  // b) With goals that can empty liquid assets: the refined solve still lands on target.
  const k = b.horizonKeep;
  const target = r.nominal[3][H] * 1.25;
  const runAt = (extra: number) => {
    const rr = simulate(buildSim(ex, ex.holdings, ws, { sipMonthly: ex.plan.sipMonthly + extra }).input);
    return { values: rr.keepValues[k], units: rr.keepUnits[k] };
  };
  const solved = await solveRequiredSip({ values: r.keepValues[k], units: r.keepUnits[k] }, target, 0.8, runAt);
  const verify = hitRate(runAt(solved.extra).values, target);
  check('required-SIP solver hits 80% within 2 points', Math.abs(verify - 0.8) <= 0.02, `extra ${fmtMoney(solved.extra, { compact: true })}/mo after ${solved.iterations} refinement(s) → ${(verify * 100).toFixed(1)}%`);
}

// 6. Risk
{
  const rb = buildRiskSim(ex, ex.holdings, ws, 4000);
  const r = simulate(rb.input);
  const rep = analyzeRisk(rb, r, ws.market.tbill.m12, ws.market.cpi);
  console.log(`Risk: mean ${(rep.mean * 100).toFixed(1)}% sd ${(rep.sd * 100).toFixed(1)}% VaR95 ${(rep.var95 * 100).toFixed(1)}% CVaR ${(rep.cvar95 * 100).toFixed(1)}% pLoss ${(rep.probLoss * 100).toFixed(0)}% Sharpe ${rep.sharpe.toFixed(2)} betaKSE ${rep.betaKse.toFixed(2)} betaSPX ${rep.betaSpx.toFixed(2)} (${r.elapsedMs.toFixed(0)} ms)`);
  console.log('Risk contributions', rep.classes.map((c) => `${c.cls} w${(c.weight * 100).toFixed(0)} rc${(c.riskContrib * 100).toFixed(0)}`).join(', '));
  const rcSum = rep.classes.reduce((s, c) => s + c.riskContrib, 0);
  check('class risk contributions sum to 100%', close(rcSum, 1, 0.02), rcSum.toFixed(3));
}

// 7. Optimizer
{
  const cs = buildClassSim(ws.assumptions, ws.market, 6000);
  const r = simulate(cs);
  const st = classStats(r);
  console.log('Class mu', st.mu.map((x) => (x * 100).toFixed(1)).join(' '), 'vol', st.vol.map((x) => (x * 100).toFixed(1)).join(' '));
  const lb = [0.05, 0, 0, 0, 0, 0];
  const ub = [1, 0.6, 0.6, 0.3, 0.5, 0.05];
  const fr = efficientFrontier(st, lb, ub, 0.12);
  console.log('Frontier points', fr.points.length, 'max Sharpe', fr.maxSharpe.w.map((x) => (x * 100).toFixed(0)).join('/'), 'ret', (fr.maxSharpe.ret * 100).toFixed(1), 'vol', (fr.maxSharpe.vol * 100).toFixed(1));
  check('frontier weights sum to 1', fr.points.every((p) => close(p.w.reduce((a, b) => a + b, 0), 1, 1e-6)));
  check('frontier respects bounds', fr.points.every((p) => p.w.every((w, i) => w >= lb[i] - 1e-6 && w <= ub[i] + 1e-6)));
  const mix = currentMix(ex.holdings, ws.market);
  console.log('Current opt mix', mix.weights.map((x) => (x * 100).toFixed(0)).join('/'), 'locked', fmtMoney(mix.locked, { compact: true }));
}

// 8. Stress
{
  for (const s of STRESS_PRESETS.slice(0, 4)) {
    const r = runStress(ex.holdings, ex.liabilities, ws.market, s.shocks);
    console.log(`Stress ${s.key}: ${r.changePct.toFixed(1)}% (${fmtMoney(r.change, { compact: true })})`);
  }
  const none = runStress(ex.holdings, ex.liabilities, ws.market, {});
  check('no shock = no change', Math.abs(none.change) < 1e-6);
}

// 9. Misc
check('lakh grouping', groupLakh('12345678') === '1,23,45,678', groupLakh('12345678'));
check('compact crore', fmtMoney(23_456_789, { compact: true }) === 'Rs 2.35 Cr', fmtMoney(23_456_789, { compact: true }));
check('rent tax slabs', rentTax(1_000_000) === 55_000 && rentTax(2_500_000) === 280_000, `${rentTax(1_000_000)} ${rentTax(2_500_000)}`);
{
  const bt = backtest({ psx: 50, pkfi: 50 }, 2010);
  console.log(`Backtest 50/50 since 2010: CAGR ${(bt.cagr * 100).toFixed(1)}% real ${(bt.realCagr * 100).toFixed(1)}% worst ${bt.worst.year} ${(bt.worst.ret * 100).toFixed(1)}% KSE CAGR ${(bt.kseCagr * 100).toFixed(1)}%`);
  check('backtest produces 16 points', bt.years.length === 16);
}
{
  const lines = incomeLines(ex.holdings, ws.market, true, '2026-10-21');
  console.log('Income lines', lines.length, 'gross', fmtMoney(lines.reduce((s, l) => s + l.gross, 0), { compact: true }), 'net', fmtMoney(lines.reduce((s, l) => s + l.net, 0), { compact: true }));
  const z = computeZakat(ex.holdings, ex.liabilities, ws.market, 'silver', {}, true);
  console.log('Zakat base', fmtMoney(z.base, { compact: true }), 'nisab', fmtMoney(z.nisab), 'due', fmtMoney(z.due));
}


// Daily data feed
{
  const feed: FeedDoc = {
    v: 1, updatedAt: '2026-10-22T19:20:00Z',
    market: { fx: { PKR: 1, USD: 276.86, AED: 75.39, SAR: 73.83, EUR: 311.2, GBP: 370.4 }, fxDate: '2026-10-22', goldTola: 437_500, silverTola: 6_100, goldDate: '2026-10-22', policyRate: 11.5, nss: { RIC: 12.12, BSC: 12.96 }, nssDate: '2026-10-21', tbill: { m1: 11.5, m3: 12.0, m6: 12.4, m12: 12.5, date: '2026-10-14' }, asOf: '2026-10-22' },
    extra: { crypto: { asOf: '2026-10-22', usd: { BTC: 82_700, ETH: 2_440 } }, kibor: { m3: { bid: 11.76, offer: 12.01 }, m6: { bid: 12.19, offer: 12.44 }, asOf: '2026-10-22' } },
  };
  const base = { ...JSON.parse(JSON.stringify(DEFAULT_MARKET)), locked: ['goldTola'] };
  const out = applyFeed(base, feed);
  check('feed updates rates and NSS per scheme', out.fx.USD === 276.86 && out.nss.RIC === 12.12 && out.nss.SSC === DEFAULT_MARKET.nss.SSC && out.nssDate === '2026-10-21');
  check('feed leaves locked fields alone', out.goldTola === DEFAULT_MARKET.goldTola && out.silverTola === 6_100);
  check('feed adds crypto and KIBOR', out.crypto?.ETH === 2_440 && out.kibor?.m6 === 12.44 && out.feedAt === feed.updatedAt);
  const bad = applyFeed(JSON.parse(JSON.stringify(DEFAULT_MARKET)), { ...feed, market: { fx: { USD: -5 } as never, policyRate: 900 } });
  check('feed ignores implausible values', bad.fx.USD === DEFAULT_MARKET.fx.USD && bad.policyRate === DEFAULT_MARKET.policyRate);
  const eth: Holding = { id: 'c1', type: 'crypto', ticker: 'ETH', name: 'Ether', currency: 'PKR', qty: 1, price: 1, useMarketPrice: true };
  check('crypto priced from the feed in the holding currency', close(unitPrice(eth, out), 2_440 * 276.86, 1e-9), String(unitPrice(eth, out)));

  const funds: FundsDoc = { v: 1, asOf: '2026-10-21', count: 3, funds: [
    { id: '12801', n: 'ABL Islamic Pension Fund', amc: 'ABL', cat: 'VPS-Shariah Compliant Debt', sec: 'Voluntary Pension Scheme (VPS)', nav: 238.0056, d: '2026-10-21' },
    { id: '12802', n: 'ABL Islamic Pension Fund', amc: 'ABL', cat: 'VPS-Shariah Compliant Equity', sec: 'Voluntary Pension Scheme (VPS)', nav: 571.4459, d: '2026-10-21' },
    { id: '14750', n: '786 Islamic Money Market Fund', amc: '786', cat: 'Shariah Compliant Money Market', sec: 'Open-End Funds', nav: 103.6103, d: '2026-10-21' },
  ] };
  const vpsEq: Holding = { id: 'v1', type: 'vps', sub: 'vps_equity', name: 'ABL Islamic Pension Fund', currency: 'PKR', qty: 100, price: 560, priceDate: '2026-09-30' };
  const mmf: Holding = { id: 'm1', type: 'mutual_fund', sub: 'islamic_mm', name: '786 islamic money market fund', currency: 'PKR', qty: 100, price: 100, priceDate: '2026-09-30' };
  const vague: Holding = { id: 'v2', type: 'vps', sub: 'vps_medium', name: 'ABL Islamic Pension Fund', currency: 'PKR', qty: 1, price: 1 };
  check('VPS sub-fund matched by sub-fund choice', matchFund(vpsEq, funds.funds)?.id === '12802');
  check('ambiguous VPS name is not auto-linked', matchFund(vague, funds.funds) === null);
  check('MUFAP category mapping', categoryFromMufap('Shariah Compliant Money Market').sub === 'islamic_mm' && categoryFromMufap('VPS-Shariah Compliant Equity').type === 'vps' && categoryFromMufap('Aggressive Fixed Income').sub === 'aggressive_income');
  const own: Portfolio = { ...emptyPortfolio('Mine'), holdings: [vpsEq, mmf, vague] };
  const exP: Portfolio = { ...emptyPortfolio('Example'), isExample: true, holdings: [{ ...mmf, id: 'x1' }] };
  const r = applyFundNavs([own, exP], funds);
  const after = r.portfolios[0].holdings;
  check('NAVs update linked funds, examples untouched', r.updated === 2 && r.linked === 2 && after[0].price === 571.4459 && after[0].feedId === '12802' && after[1].priceDate === '2026-10-21' && r.portfolios[1] === exP);
  const again = applyFundNavs(r.portfolios, funds);
  check('NAV update is idempotent', again.updated === 0 && again.linked === 0);
  check('ETF category maps to an index fund', categoryFromMufap('Shariah Compliant Exchange Traded Fund').sub === 'index' && categoryFromMufap('Exchange Traded Fund').shariah === 'unknown');
}

// PSX daily prices and the KSE-100 from the feed
{
  const feed: FeedDoc = {
    v: 1, updatedAt: '2026-10-22T03:40:00Z',
    market: { kse100: 163_942.22, kse100Date: '2026-10-21', kse100Ytd: -5.8, kse100Ath: 189_167 },
    extra: { psx: { asOf: '2026-10-21', indices: { KSE100: { v: 163_942.22, chg: -1_988.76, chgPct: -1.2 }, KMI30: { v: 235_350.16, chg: -3_534.39, chgPct: -1.48 }, BAD: { v: -1 } } } },
  };
  const out = applyFeed(JSON.parse(JSON.stringify(DEFAULT_MARKET)), feed);
  check('KSE-100 level, date, YTD and record from the feed', out.kse100 === 163_942.22 && out.kse100Date === '2026-10-21' && out.kse100Ytd === -5.8 && out.kse100Ath === 189_167);
  check('PSX index table from the feed', out.psxIndices?.rows.KMI30.chgPct === -1.48 && !out.psxIndices?.rows.BAD && out.psxIndices?.date === '2026-10-21');
  const locked = applyFeed({ ...JSON.parse(JSON.stringify(DEFAULT_MARKET)), locked: ['kse100'] }, feed);
  check('typed KSE-100 is kept with its YTD', locked.kse100 === DEFAULT_MARKET.kse100 && locked.kse100Ytd === DEFAULT_MARKET.kse100Ytd);

  const psx = parsePsx({ v: 1, asOf: '2026-10-21', count: 4, stocks: [
    { s: 'MEBL', n: 'Meezan Bank Limited', sec: 'Commercial Banks', p: 544.1, sh: 1, k100: 1, dy: 5.71 },
    { s: 'OGDC', n: 'Oil & Gas Development Company Limited', sec: 'Oil & Gas Exploration Companies', p: 298.49, x: 'XD' },
    { s: 'MZNPETF', n: 'Meezan Pakistan ETF', sec: 'Exchange Traded Funds', p: 16.82, etf: 1, d: '2026-10-20' },
    { s: 'JUNK', n: 'No price', p: 0 },
  ] }) as PsxDoc;
  check('PSX list drops rows without a price', psx.count === 3 && parsePsx({ asOf: '2026-10-21', stocks: [] }) === null);
  const mk = (id: string, patch: Partial<Holding>): Holding => ({ id, type: 'psx_stock', name: id, currency: 'PKR', qty: 100, price: 1, ...patch });
  const own: Portfolio = { ...emptyPortfolio('Mine'), holdings: [
    mk('a', { ticker: 'mebl', priceDate: '2026-10-01' }),
    mk('b', { ticker: 'OGDC', price: 300, priceDate: '2026-10-22' }),
    mk('c', { ticker: 'MZNPETF', type: 'psx_etf', priceDate: '2026-10-01' }),
    mk('d', { ticker: 'MEBL', autoPrice: false, priceDate: '2026-10-01' }),
    mk('e', { ticker: 'NOPE' }),
  ] };
  const exP: Portfolio = { ...emptyPortfolio('Example'), isExample: true, holdings: [mk('x', { ticker: 'MEBL' })] };
  const r = applyPsxPrices([own, exP], psx);
  const h = Object.fromEntries(r.portfolios[0].holdings.map((x) => [x.id, x]));
  check('PSX price applied with its trading day', h.a.price === 544.1 && h.a.priceDate === '2026-10-21' && h.a.priceSrc === 'psx' && h.a.sector === 'Commercial banks');
  check('price typed after the close is kept', h.b.price === 300 && h.b.priceDate === '2026-10-22');
  check('ETF uses its own price date', h.c.price === 16.82 && h.c.priceDate === '2026-10-20');
  check('holdings set to keep their price are left alone', h.d.price === 1 && h.e.price === 1 && r.portfolios[1] === exP && r.updated === 2);
  const again = applyPsxPrices(r.portfolios, psx);
  check('PSX update is idempotent', again.updated === 0 && again.portfolios.every((p, i) => p === r.portfolios[i]));
  check('PSX search: symbol first, then names', searchPsx(psx, 'MEBL')[0].s === 'MEBL' && searchPsx(psx, 'oil gas')[0].s === 'OGDC' && searchPsx(psx, 'meezan', { etf: true }).map((x) => x.s).join() === 'MZNPETF');
  check('PSX sector and name clean-up', sectorFromPsx('Oil & Gas Exploration Companies') === 'Oil & gas exploration' && sectorFromPsx('Modarabas') === 'Other' && companyName('The Hub Power Company Limited') === 'The Hub Power Company' && companyName('Meezan Pakistan ETF') === 'Meezan Pakistan ETF');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
if (failures) process.exit(1);
