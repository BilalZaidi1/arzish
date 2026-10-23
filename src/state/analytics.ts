// React hooks that run the engine (in the worker) and share results across views.

import { useEffect, useMemo, useState } from 'react';
import { buildSim, type BuildOptions, type BuiltSim } from '../engine/exposures';
import { buildClassSim, classStats, type ClassStats } from '../engine/optimize';
import { analyzeRisk, buildRiskSim, type RiskReport } from '../engine/risk';
import type { SimResult } from '../engine/simtypes';
import type { Holding, Portfolio, Workspace } from '../engine/types';
import { hashKey, runSimCached } from './simClient';
import { useFilteredHoldings, useWS } from './store';

export interface ForecastState {
  res?: SimResult;
  built?: BuiltSim;
  loading: boolean;
  error?: string;
}

function optsKey(o: BuildOptions & { keyExtra?: string }): string {
  const { startShock, assumptions, ...rest } = o;
  return JSON.stringify({ ...rest, a: assumptions ? hashKey(JSON.stringify(assumptions)) : undefined });
}

export function forecastKey(p: Portfolio, holdings: Holding[], ws: Workspace, o: BuildOptions & { keyExtra?: string }): string {
  return hashKey(
    JSON.stringify({
      h: holdings,
      l: p.liabilities,
      g: p.goals,
      plan: p.plan,
      tm: p.targetMix,
      m: ws.market,
      a: ws.assumptions,
      s: [ws.settings.filer, ws.settings.nisabBasis, ws.settings.foreignCgtRate],
      o: optsKey(o),
    }),
  );
}

export function useForecast(opts: BuildOptions & { enabled?: boolean; keyExtra?: string } = {}, holdingsOverride?: Holding[], portfolioOverride?: Portfolio): ForecastState {
  const { ws, active } = useWS();
  const filtered = useFilteredHoldings();
  const holdings = holdingsOverride ?? filtered;
  const p = portfolioOverride ?? active;
  const key = useMemo(() => forecastKey(p, holdings, ws, opts), [p, holdings, ws.market, ws.assumptions, ws.settings.filer, ws.settings.nisabBasis, ws.settings.foreignCgtRate, optsKey(opts)]);
  const [state, setState] = useState<ForecastState>({ loading: true });
  useEffect(() => {
    if (opts.enabled === false) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const t = window.setTimeout(() => {
      try {
        const built = buildSim(p, holdings, ws, opts);
        runSimCached(key, built.input)
          .then((res) => alive && setState({ res, built, loading: false }))
          .catch((e) => alive && setState((s) => ({ ...s, loading: false, error: String(e?.message ?? e) })));
      } catch (e) {
        if (alive) setState((s) => ({ ...s, loading: false, error: String((e as Error)?.message ?? e) }));
      }
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [key, opts.enabled]);
  return state;
}

export interface RiskState {
  report?: RiskReport;
  loading: boolean;
  error?: string;
}

export function useRisk(holdingsOverride?: Holding[], enabled = true, months = 12): RiskState {
  const { ws, active } = useWS();
  const filtered = useFilteredHoldings();
  const holdings = holdingsOverride ?? filtered;
  const key = useMemo(
    () => hashKey(JSON.stringify({ k: 'risk', h: holdings, m: ws.market, a: ws.assumptions, s: active.plan.seed, n: months })),
    [holdings, ws.market, ws.assumptions, active.plan.seed, months],
  );
  const [state, setState] = useState<RiskState>({ loading: true });
  useEffect(() => {
    if (!enabled) return;
    if (!holdings.length) {
      setState({ loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const t = window.setTimeout(() => {
      const rb = buildRiskSim(active, holdings, ws, 5000, months);
      const years = months / 12;
      // Hurdles compound over the horizon so multi-year figures compare like with like.
      const rf = (Math.pow(1 + ws.market.tbill.m12 / 100, years) - 1) * 100;
      const infl = (Math.pow(1 + ws.market.cpi / 100, years) - 1) * 100;
      runSimCached(key, rb.input)
        .then((res) => alive && setState({ report: analyzeRisk(rb, res, rf, infl), loading: false }))
        .catch((e) => alive && setState({ loading: false, error: String(e?.message ?? e) }));
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [key, enabled]);
  return state;
}

export function useClassStats(): { stats?: ClassStats; loading: boolean } {
  const { ws } = useWS();
  const key = useMemo(() => hashKey(JSON.stringify({ k: 'cls', a: ws.assumptions, fx: ws.market.fx.USD })), [ws.assumptions, ws.market.fx.USD]);
  const [state, setState] = useState<{ stats?: ClassStats; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    const input = buildClassSim(ws.assumptions, ws.market, 8000);
    runSimCached(key, input)
      .then((res) => alive && setState({ stats: classStats(res), loading: false }))
      .catch(() => alive && setState({ loading: false }));
    return () => {
      alive = false;
    };
  }, [key]);
  return state;
}
