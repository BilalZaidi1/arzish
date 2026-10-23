// Monte Carlo engine: correlated monthly factor shocks, Pakistan macro links (short rate, CPI,
// USD/PKR with devaluation jumps), holdings mapped onto factors, and the investor's cash flows.

import { Rng } from './rng';
import { percentileSorted } from './linalg';
import { PCTS, type SimInput, type SimResult } from './simtypes';

const KIND = { factor: 0, rate: 1, fixed: 2, mix: 3, zero: 4 } as const;

export function simulate(input: SimInput): SimResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const months = Math.max(1, Math.min(720, Math.round(input.months)));
  const P = Math.max(1, Math.round(input.paths));
  const A = input.assets;
  const nA = A.length;
  const plan = input.plan;
  const mac = input.macro;
  const L = input.chol;
  const nF = 9;
  const rng = new Rng(input.seed);
  const sqrt12 = Math.sqrt(12);

  // Factor monthly parameters [psx, gleq, glbond, gold, re, crypto]
  const fS = input.fVol.map((v) => v / 100 / sqrt12);
  const fMu = input.fCagr.map((g) => Math.log(1 + g / 100) / 12);
  const muPsx = fMu[0], muGleq = fMu[1], muGold = fMu[3];

  const mFx = Math.log(1 + mac.fxDrift / 100) / 12;
  const sFx = mac.fxVol / 100 / sqrt12;
  const pJump = 1 - Math.pow(1 - Math.min(0.99, Math.max(0, mac.jumpProb / 100)), 1 / 12);
  const jumpLog = Math.log(1 + mac.jumpSize / 100);
  const jumpPsxLog = Math.log(1 + mac.jumpPsx / 100);
  const jumpRate = mac.jumpRate / 100;
  const jumpCpi = mac.jumpCpi / 100;
  const kR = mac.rateKappa / 12, thR = mac.rateLR / 100, sR = mac.rateVol / 100 / sqrt12;
  const kC = mac.cpiKappa / 12, thC = mac.cpiLR / 100, sC = mac.cpiVol / 100 / sqrt12;
  const incSpread = mac.incomeSpread / 100, incDur = mac.incomeDuration, mmfSpread = mac.mmfSpread / 100;
  const usInflM = Math.log(1 + mac.usInflation / 100) / 12;

  // Flatten asset parameters
  const kind = new Int8Array(nA);
  const mu = new Float64Array(nA);
  const load = new Float64Array(nA * 6);
  const idio = new Float64Array(nA);
  const fxE = new Float64Array(nA);
  const cross = new Float64Array(nA);
  const jPsx = new Float64Array(nA);
  const spread = new Float64Array(nA);
  const dur = new Float64Array(nA);
  const ter = new Float64Array(nA);
  const coupon = new Float64Array(nA);
  const matM = new Float64Array(nA);
  const reSpread = new Float64Array(nA);
  const mix = new Float64Array(nA * 5);
  const yM = new Float64Array(nA);
  const pays = new Uint8Array(nA);
  const iTax = new Float64Array(nA);
  const rent0 = new Float64Array(nA);
  const rentTax = new Float64Array(nA);
  const liquid = new Uint8Array(nA);
  const invest = new Uint8Array(nA);
  const zak = new Float64Array(nA);
  const corpus = new Uint8Array(nA);
  const clsIdx = new Int8Array(nA);
  const v0 = new Float64Array(nA);
  const cw = new Float64Array(nA);
  const rw = new Float64Array(nA);
  for (let i = 0; i < nA; i++) {
    const a = A[i];
    kind[i] = KIND[a.kind];
    mu[i] = a.mu;
    for (let k = 0; k < 6; k++) load[i * 6 + k] = (a.load[k] ?? 0) * fS[k];
    idio[i] = a.idio;
    fxE[i] = a.fx;
    cross[i] = a.cross;
    jPsx[i] = a.jumpPsx * jumpPsxLog;
    spread[i] = a.spread / 100;
    dur[i] = a.duration;
    ter[i] = a.ter / 100 / 12;
    coupon[i] = a.coupon / 100;
    matM[i] = a.maturityMonth;
    reSpread[i] = a.reinvestSpread / 100;
    for (let k = 0; k < 5; k++) mix[i * 5 + k] = a.mix[k] ?? 0;
    yM[i] = a.yieldAnnual / 12;
    pays[i] = a.paysIncome ? 1 : 0;
    iTax[i] = plan.applyTax ? a.incomeTax : 0;
    rent0[i] = a.rent0;
    rentTax[i] = plan.applyTax ? a.rentTaxRate : 0;
    liquid[i] = a.liquid ? 1 : 0;
    invest[i] = a.investable ? 1 : 0;
    zak[i] = a.zakatable;
    corpus[i] = a.cls === 4 ? 0 : 1; // real estate excluded from corpus goals
    clsIdx[i] = a.cls;
    v0[i] = a.value0;
    cw[i] = plan.contribWeights[i] ?? 0;
    rw[i] = plan.rebalanceWeights[i] ?? 0;
  }

  // Lump sums by month
  const lumpBy = new Float64Array(months + 1);
  for (const l of plan.lumps) if (l.month >= 0 && l.month < months) lumpBy[l.month] += l.amount;
  const goalsBy: Map<number, number[]> = new Map();
  plan.goals.forEach((g, gi) => {
    if (g.month < 0 || g.month > months) return;
    const list = goalsBy.get(g.month) ?? [];
    list.push(gi);
    goalsBy.set(g.month, list);
  });
  const goalTargets = plan.goals.map((g) => g.amountToday * Math.pow(1 + g.inflation / 100, Math.max(0, g.month) / 12));

  const years = Math.ceil(months / 12);
  const nPts = years + 1;
  const pointMonth = new Int32Array(nPts);
  for (let k = 0; k < nPts; k++) pointMonth[k] = Math.min(months, k * 12);
  const monthToPoint = new Int32Array(months + 1).fill(-1);
  for (let k = 0; k < nPts; k++) monthToPoint[pointMonth[k]] = k;

  const recNom = new Float64Array(nPts * P);
  const recReal = new Float64Array(nPts * P);
  const recUsd = new Float64Array(nPts * P);
  const recUsdReal = new Float64Array(nPts * P);
  const recInc = input.trackIncome ? new Float64Array(nPts * P) : null;
  const recTax = new Float64Array(nPts * P);
  const recZak = new Float64Array(nPts * P);
  const recCpi = new Float64Array(nPts * P);
  const recFx = new Float64Array(nPts * P);
  const recRate = new Float64Array(nPts * P);
  const recCls = input.perClass ? new Float32Array(nPts * P * 8) : null;
  const recWithdraw = new Float64Array(nPts * P);
  const terminalLiquid = new Float64Array(P);
  const unitTerminal = new Float64Array(P);
  const keepIdx = new Map<number, number>();
  input.keepMonths.forEach((mm, k) => keepIdx.set(Math.min(months, Math.max(0, mm)), k));
  const keepValues = input.keepMonths.map(() => new Float64Array(P));
  const keepUnits = input.keepMonths.map(() => new Float64Array(P));
  const keepCpi = input.keepMonths.map(() => new Float64Array(P));
  const goalFunded = plan.goals.map(() => new Float64Array(P));
  const assetEnd = input.recordAssetEnd ? new Float64Array(P * nA) : undefined;
  const twrEnd = new Float64Array(P);
  const ddMax = new Float64Array(P);
  const realTwr = new Float64Array(P);
  let loss1y = 0;
  let shortfallPaths = 0;
  let survived = 0;
  const depletion: number[] = [];
  const samplesN = Math.min(input.samplePaths, P);
  const samples: number[][] = [];

  const contribCum = new Float64Array(nPts);
  const v = new Float64Array(nA);
  const u = new Float64Array(nA);
  const z = new Float64Array(nF);
  const e = new Float64Array(nF);
  const shock = new Float64Array(6);
  const ret = plan.retirement;
  const zakatOn = plan.applyZakat;

  for (let p = 0; p < P; p++) {
    for (let i = 0; i < nA; i++) {
      v[i] = v0[i];
      u[i] = 0;
    }
    let r = mac.rate0 / 100;
    let pi = mac.cpi0 / 100;
    let cpiIdx = 1;
    let fxLvl = 1;
    let usDefl = 1;
    let twr = 1, peak = 1, maxDD = 0;
    let sip = plan.sip;
    let unitSip = 1;
    let cumContrib = 0;
    let cumWithdraw = 0;
    let incYear = 0, taxYear = 0, zakYear = 0;
    let hadShortfall = false;
    let depleted = -1;

    // t = 0 snapshot
    {
      let tot = 0;
      for (let i = 0; i < nA; i++) tot += v[i];
      const net = tot - plan.liabilities[0];
      recNom[p] = net;
      recReal[p] = net;
      recUsd[p] = net / input.fx0;
      recUsdReal[p] = net / input.fx0;
      recCpi[p] = 1;
      recFx[p] = input.fx0;
      recRate[p] = r;
      if (recCls) for (let i = 0; i < nA; i++) recCls[(0 * P + p) * 8 + clsIdx[i]] += v[i];
    }

    for (let m = 0; m < months; m++) {
      // 1. Correlated shocks
      for (let k = 0; k < nF; k++) z[k] = rng.normal();
      for (let a = 0; a < nF; a++) {
        let s = 0;
        const row = L[a];
        for (let b = 0; b <= a; b++) s += row[b] * z[b];
        e[a] = s;
      }
      for (let k = 0; k < 6; k++) shock[k] = e[k];
      const jump = rng.uniform() < pJump;
      const xfx = mFx + sFx * e[6] + (jump ? jumpLog : 0);
      let rNext = r + kR * (thR - r) + sR * e[7] + (jump ? jumpRate : 0);
      if (rNext < 0.01) rNext = 0.01;
      let piNext = pi + kC * (thC - pi) + sC * e[8] + (jump ? jumpCpi : 0);
      if (piNext < -0.02) piNext = -0.02;
      const dR = rNext - r;

      // Fund components (simple returns)
      const s0 = fS[0] * shock[0], s1 = fS[1] * shock[1], s3 = fS[3] * shock[3];
      const cEq = Math.exp(muPsx + s0 + (jump ? jumpPsxLog : 0)) - 1;
      const cInc = (r + incSpread) / 12 - incDur * dR;
      const cCash = Math.max(0, r + mmfSpread) / 12;
      const cGold = Math.exp(muGold + s3 + xfx) - 1;
      const cGlob = Math.exp(muGleq + s1 + xfx) - 1;

      // 2. Returns
      let before = 0, after = 0, paid = 0, rentPool = 0, incM = 0, taxM = 0;
      for (let i = 0; i < nA; i++) {
        const vi = v[i];
        before += vi;
        let g = 0, y = 0;
        switch (kind[i]) {
          case 0: {
            let lr = mu[i];
            const o = i * 6;
            lr += load[o] * shock[0] + load[o + 1] * shock[1] + load[o + 2] * shock[2] + load[o + 3] * shock[3] + load[o + 4] * shock[4] + load[o + 5] * shock[5];
            if (idio[i] > 0) lr += idio[i] * rng.normal();
            if (fxE[i] !== 0) lr += fxE[i] * xfx;
            if (cross[i] > 0) lr += cross[i] * rng.normal();
            if (jump) lr += jPsx[i];
            g = Math.exp(lr) - 1;
            y = yM[i];
            break;
          }
          case 1: {
            let base = r + spread[i];
            if (base < 0) base = 0;
            g = base / 12 - ter[i] - dur[i] * dR;
            y = pays[i] ? base / 12 : 0;
            break;
          }
          case 2: {
            if (m < matM[i]) {
              const remain = matM[i] > 0 ? 1 - m / matM[i] : 0;
              g = coupon[i] / 12 - ter[i] - dur[i] * remain * dR;
              y = pays[i] ? coupon[i] / 12 : 0;
            } else {
              const base = Math.max(0, r + reSpread[i]);
              g = base / 12 - ter[i];
              y = pays[i] ? base / 12 : 0;
            }
            break;
          }
          case 3: {
            const o = i * 5;
            g = mix[o] * cEq + mix[o + 1] * (cInc + spread[i] / 12) + mix[o + 2] * cCash + mix[o + 3] * cGold + mix[o + 4] * cGlob - ter[i];
            y = yM[i];
            break;
          }
          default:
            g = 0;
            y = 0;
        }
        const inc = vi * y;
        const tx = inc * iTax[i];
        let nv: number;
        if (plan.reinvestIncome) nv = vi * (1 + g) - tx;
        else {
          nv = vi * (1 + g - y);
          paid += inc - tx;
        }
        if (nv < 0) nv = 0;
        v[i] = nv;
        after += nv;
        incM += inc;
        taxM += tx;
        // shadow unit portfolio
        const ui = u[i];
        if (ui !== 0) {
          const uinc = ui * y;
          u[i] = plan.reinvestIncome ? ui * (1 + g) - uinc * iTax[i] : ui * (1 + g - y);
          if (u[i] < 0) u[i] = 0;
        }
        // rent
        if (rent0[i] !== 0) {
          const rent = rent0[i] * cpiIdx;
          const rtx = rent * rentTax[i];
          incM += rent;
          taxM += rtx;
          if (plan.reinvestIncome) rentPool += rent - rtx;
          else paid += rent - rtx;
        }
      }
      // time-weighted return of the month
      if (before > 0) {
        const pr = (after + paid + rentPool) / before - 1;
        twr *= 1 + pr;
        if (twr > peak) peak = twr;
        const dd = 1 - twr / peak;
        if (dd > maxDD) maxDD = dd;
      }
      if (m === 11 && twr < 1) loss1y++;
      incYear += incM;
      taxYear += taxM;

      // 3. Contributions (SIP + lump sums + reinvested rent)
      const contrib = sip + lumpBy[m];
      cumContrib += contrib;
      const pool = contrib + rentPool;
      if (pool !== 0) for (let i = 0; i < nA; i++) if (cw[i] !== 0) v[i] += pool * cw[i];
      for (let i = 0; i < nA; i++) if (cw[i] !== 0) u[i] += unitSip * cw[i];

      // 4. Withdrawals (plan, retirement, goals)
      let out = 0;
      for (const w of plan.withdrawals) if (m >= w.start && m < w.end) out += w.monthly * (w.indexed ? cpiIdx : 1);
      let retOut = 0;
      if (ret && m >= ret.start && m < ret.end) retOut = ret.monthly * cpiIdx;
      out += retOut;
      if (out > 0) {
        let liq = 0;
        for (let i = 0; i < nA; i++) if (liquid[i]) liq += v[i];
        if (liq > 0) {
          const f = Math.min(1, out / liq);
          for (let i = 0; i < nA; i++) if (liquid[i]) v[i] *= 1 - f;
        }
        cumWithdraw += Math.min(out, liq);
        if (out > liq + 1e-6) {
          hadShortfall = true;
          if (retOut > 0 && depleted < 0) depleted = m;
        }
      }
      const gl = goalsBy.get(m + 1);
      if (gl || keepIdx.has(m + 1)) {
        let liq = 0, corp = 0, utot = 0;
        for (let i = 0; i < nA; i++) {
          if (liquid[i]) liq += v[i];
          if (corpus[i]) corp += v[i];
          utot += u[i];
        }
        const ki = keepIdx.get(m + 1);
        if (ki !== undefined) {
          const gIdx = gl ? gl[0] : -1;
          const useLiquid = gIdx >= 0 ? plan.goals[gIdx].withdraw : false;
          keepValues[ki][p] = (useLiquid ? liq : corp) - (useLiquid ? 0 : plan.liabilities[m + 1]);
          keepUnits[ki][p] = utot;
          keepCpi[ki][p] = cpiIdx;
        }
        if (gl) {
          for (const gi of gl) {
            const tgt = goalTargets[gi];
            const g = plan.goals[gi];
            if (g.withdraw) {
              const take = Math.min(tgt, liq);
              goalFunded[gi][p] = tgt > 0 ? take / tgt : 1;
              if (liq > 0 && take > 0) {
                const f = take / liq;
                for (let i = 0; i < nA; i++) if (liquid[i]) v[i] *= 1 - f;
                liq -= take;
              }
              cumWithdraw += take;
            } else {
              const val = corp - plan.liabilities[m + 1];
              goalFunded[gi][p] = tgt > 0 ? Math.min(1, Math.max(0, val / tgt)) : 1;
            }
          }
        }
      }

      // 5. Yearly: zakat and rebalancing
      if ((m + 1) % 12 === 0) {
        if (zakatOn) {
          let base = 0;
          for (let i = 0; i < nA; i++) base += v[i] * zak[i];
          if (base >= plan.nisab0 * cpiIdx && base > 0) {
            const zk = base * 0.025;
            let liq = 0;
            for (let i = 0; i < nA; i++) if (liquid[i]) liq += v[i];
            if (liq > 0) {
              const f = Math.min(1, zk / liq);
              for (let i = 0; i < nA; i++) if (liquid[i]) v[i] *= 1 - f;
            }
            for (let i = 0; i < nA; i++) u[i] *= 1 - 0.025 * zak[i];
            zakYear += Math.min(zk, liq);
          }
        }
        if (plan.rebalance === 'annual') {
          let it = 0, ut = 0;
          for (let i = 0; i < nA; i++)
            if (invest[i]) {
              it += v[i];
              ut += u[i];
            }
          if (it > 0) for (let i = 0; i < nA; i++) if (invest[i]) v[i] = it * rw[i];
          if (ut > 0) for (let i = 0; i < nA; i++) if (invest[i]) u[i] = ut * rw[i];
        }
        sip *= 1 + plan.stepUp / 100;
        unitSip *= 1 + plan.stepUp / 100;
      }

      // 6. Macro state
      cpiIdx *= 1 + pi / 12;
      pi = piNext;
      r = rNext;
      fxLvl *= Math.exp(xfx);
      usDefl *= Math.exp(usInflM);

      // 7. Snapshot
      const pt = monthToPoint[m + 1];
      if (pt >= 0) {
        let tot = 0;
        for (let i = 0; i < nA; i++) tot += v[i];
        const net = tot - plan.liabilities[m + 1];
        const idx = pt * P + p;
        recNom[idx] = net;
        recReal[idx] = net / cpiIdx;
        const usd = net / (input.fx0 * fxLvl);
        recUsd[idx] = usd;
        recUsdReal[idx] = usd / usDefl;
        if (recInc) recInc[idx] = incYear;
        recTax[idx] = taxYear;
        recZak[idx] = zakYear;
        recCpi[idx] = cpiIdx;
        recFx[idx] = input.fx0 * fxLvl;
        recRate[idx] = r;
        recWithdraw[idx] = cumWithdraw;
        if (recCls) for (let i = 0; i < nA; i++) recCls[idx * 8 + clsIdx[i]] += v[i];
        if (p === 0) contribCum[pt] = cumContrib;
        incYear = 0;
        taxYear = 0;
        zakYear = 0;
      }
    }

    let liqEnd = 0, uEnd = 0;
    for (let i = 0; i < nA; i++) {
      if (liquid[i]) liqEnd += v[i];
      uEnd += u[i];
    }
    terminalLiquid[p] = liqEnd;
    if (assetEnd) for (let i = 0; i < nA; i++) assetEnd[p * nA + i] = v[i];
    unitTerminal[p] = uEnd;
    twrEnd[p] = twr;
    ddMax[p] = maxDD;
    realTwr[p] = twr / cpiIdx;
    if (hadShortfall) shortfallPaths++;
    if (ret) {
      if (depleted < 0) survived++;
      else depletion.push(depleted);
    }
    if (p < samplesN) {
      const row: number[] = [];
      for (let k = 0; k < nPts; k++) row.push(recNom[k * P + p]);
      samples.push(row);
    }
  }

  // ---- Aggregate ----
  const pctOf = (rec: Float64Array): number[][] => {
    const out = PCTS.map(() => new Array<number>(nPts).fill(0));
    const tmp = new Float64Array(P);
    for (let k = 0; k < nPts; k++) {
      for (let p = 0; p < P; p++) tmp[p] = rec[k * P + p];
      tmp.sort();
      PCTS.forEach((q, qi) => (out[qi][k] = percentileSorted(tmp, q)));
    }
    return out;
  };
  const nominal = pctOf(recNom);
  const real = pctOf(recReal);
  const usd = pctOf(recUsd);
  const usdReal = pctOf(recUsdReal);
  const cpiPct = pctOf(recCpi);
  const fxPct = pctOf(recFx);
  const ratePct = pctOf(recRate);
  const incomePct = recInc ? pctOf(recInc) : [];
  const medOf = (rec: Float64Array) => pctOf(rec)[3];
  const taxMedian = medOf(recTax);
  const zakatMedian = medOf(recZak);
  const withdrawCum = medOf(recWithdraw);

  const last = nPts - 1;
  const terminalNominal = new Float64Array(P);
  const terminalReal = new Float64Array(P);
  for (let p = 0; p < P; p++) {
    terminalNominal[p] = recNom[last * P + p];
    terminalReal[p] = recReal[last * P + p];
  }

  // Central paths composition (10% of paths around the median terminal value)
  const classCentral: number[][] = Array.from({ length: 8 }, () => new Array<number>(nPts).fill(0));
  if (recCls) {
    const order = Array.from({ length: P }, (_, i) => i).sort((a, b) => terminalNominal[a] - terminalNominal[b]);
    const lo = Math.floor(P * 0.45), hi = Math.max(lo + 1, Math.ceil(P * 0.55));
    const chosen = order.slice(lo, hi);
    for (const p of chosen)
      for (let k = 0; k < nPts; k++) for (let c = 0; c < 8; c++) classCentral[c][k] += recCls[(k * P + p) * 8 + c] / chosen.length;
  }

  const sortedTwr = Float64Array.from(twrEnd, (x) => (Math.pow(Math.max(x, 1e-9), 12 / months) - 1) * 100).sort();
  const sortedDD = Float64Array.from(ddMax).sort();
  let realPos = 0;
  for (let p = 0; p < P; p++) if (realTwr[p] > 1) realPos++;

  const goals = plan.goals.map((g, gi) => {
    const f = goalFunded[gi];
    let ok = 0;
    for (let p = 0; p < P; p++) if (f[p] >= 0.999) ok++;
    const sorted = Float64Array.from(f).sort();
    return { id: g.id, prob: ok / P, medianFundedPct: percentileSorted(sorted, 0.5) * 100, targetNominal: goalTargets[gi] };
  });

  let survival: SimResult['survival'];
  if (ret) {
    depletion.sort((a, b) => a - b);
    survival = { prob: survived / P, depletionMedianMonth: depletion.length ? depletion[Math.floor(depletion.length / 2)] : null };
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    months,
    paths: P,
    points: Array.from(pointMonth),
    nominal,
    real,
    usd,
    usdReal,
    classCentral,
    contribCum: Array.from(contribCum),
    withdrawCum,
    incomePct,
    taxMedian,
    zakatMedian,
    cpiPct,
    fxPct,
    ratePct,
    terminalNominal,
    terminalReal,
    terminalLiquid,
    unitTerminal,
    keepValues,
    keepUnits,
    keepCpi,
    goals,
    twrCagrPct: [percentileSorted(sortedTwr, 0.1), percentileSorted(sortedTwr, 0.5), percentileSorted(sortedTwr, 0.9)],
    realTwrPositive: realPos / P,
    probLoss1y: months >= 12 ? loss1y / P : NaN,
    maxDD: { median: percentileSorted(sortedDD, 0.5), p90: percentileSorted(sortedDD, 0.9) },
    survival,
    shortfallProb: shortfallPaths / P,
    medianGrowth: 0,
    samples,
    cholRepaired: false,
    assetEnd,
    elapsedMs: t1 - t0,
  };
}

export interface SipProbe {
  values: ArrayLike<number>;
  units: ArrayLike<number>;
}

/** Share of paths whose value reaches the target. */
export function hitRate(values: ArrayLike<number>, target: number): number {
  let ok = 0;
  for (let i = 0; i < values.length; i++) if (values[i] >= target) ok++;
  return values.length ? ok / values.length : 0;
}

/** Required extra monthly SIP so value ≥ target with probability `prob`.
 *  Starts from the exact linear solution, then re-simulates through `run` to correct for the
 *  non-linear cases (a goal or withdrawal that empties liquid assets also absorbs extra savings). */
export async function solveRequiredSip(
  first: SipProbe, target: number, prob: number, run: (extra: number) => SipProbe | Promise<SipProbe>, maxIter = 3,
): Promise<{ extra: number; prob: number; iterations: number }> {
  let x = requiredExtraSip(first.values, first.units, target, prob);
  if (!isFinite(x)) return { extra: x, prob: hitRate(first.values, target), iterations: 0 };
  if (x <= 0) return { extra: 0, prob: hitRate(first.values, target), iterations: 0 };
  let achieved = hitRate(first.values, target);
  for (let it = 1; it <= maxIter; it++) {
    const p = await run(x);
    achieved = hitRate(p.values, target);
    if (achieved >= prob - 0.005) return { extra: x, prob: achieved, iterations: it };
    const dx = requiredExtraSip(p.values, p.units, target, prob);
    if (!isFinite(dx)) return { extra: Number.POSITIVE_INFINITY, prob: achieved, iterations: it };
    x += Math.max(dx, x * 0.005);
  }
  return { extra: x, prob: achieved, iterations: maxIter };
}

/** Exact required extra monthly SIP so that value ≥ target with probability `prob`,
 *  using linearity of terminal wealth in the SIP amount (shadow unit portfolio). */
export function requiredExtraSip(values: ArrayLike<number>, units: ArrayLike<number>, target: number, prob: number): number {
  const n = values.length;
  const need = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const gap = target - values[i];
    if (gap <= 0) need[i] = 0;
    else need[i] = units[i] > 1e-9 ? gap / units[i] : Number.POSITIVE_INFINITY;
  }
  need.sort();
  return percentileSorted(need, prob);
}
