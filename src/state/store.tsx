// Workspace + UI state, persistence and theme colors.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createWorkspace } from '../engine/samples';
import type { AssetType, Filters, Holding, Portfolio, Workspace } from '../engine/types';
import { DEFAULT_FILTERS } from '../engine/types';
import { applyFilters } from '../engine/valuation';
import { applyFeed, applyFundNavs, applyPsxPrices, type FeedDoc, type FundsDoc, type PsxDoc } from '../engine/feed';
import { connectCloud, loadLocal, saveLocal, type CloudStore } from './persistence';
import { loadFeed, loadFunds, loadPsx } from './feedSource';
import { ownCounts, useEntitlements } from './entitlements';

export type View =
  | 'overview' | 'holdings' | 'allocation' | 'income'
  | 'forecast' | 'goals' | 'compare'
  | 'risk' | 'stress' | 'optimizer'
  | 'tax' | 'markets' | 'insights' | 'settings';

export const VIEWS: View[] = ['overview', 'holdings', 'allocation', 'income', 'forecast', 'goals', 'compare', 'risk', 'stress', 'optimizer', 'tax', 'markets', 'insights', 'settings'];
/** URL hash token per view (some words are reserved by the viewer). */
export const VIEW_HASH: Record<View, string> = {
  overview: 'overview', holdings: 'holdings', allocation: 'allocation', income: 'income', forecast: 'forecast', goals: 'goals',
  compare: 'compare', risk: 'risk', stress: 'stress', optimizer: 'optimizer', tax: 'tax', markets: 'markets', insights: 'insights', settings: 'profile',
};

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'local' | 'readonly' | 'error' | 'too_large';

interface WsCtx {
  ws: Workspace;
  active: Portfolio;
  update: (fn: (ws: Workspace) => Workspace) => void;
  updatePortfolio: (fn: (p: Portfolio) => Portfolio) => void;
  replace: (ws: Workspace) => void;
  saveStatus: SaveStatus;
  storage: 'cloud' | 'local';
}

const WorkspaceContext = createContext<WsCtx | null>(null);

export interface FeedCtx {
  /** 'loading' until the shared store answers; 'none' when there is no daily data in this view. */
  state: 'loading' | 'ready' | 'none';
  feed: FeedDoc | null;
  funds: FundsDoc | null;
  psx: PsxDoc | null;
  /** Result of the last automatic fund NAV update in this visit. */
  navUpdate: { updated: number; linked: number } | null;
  /** Number of PSX holdings whose price changed in the last automatic update in this visit. */
  psxUpdate: number;
}

const FeedContext = createContext<FeedCtx>({ state: 'none', feed: null, funds: null, psx: null, navUpdate: null, psxUpdate: 0 });

export function useFeed(): FeedCtx {
  return useContext(FeedContext);
}

export function useWS(): WsCtx {
  const c = useContext(WorkspaceContext);
  if (!c) throw new Error('WorkspaceContext missing');
  return c;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [ws, setWs] = useState<Workspace>(() => loadLocal() ?? createWorkspace());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [storage, setStorage] = useState<'cloud' | 'local'>('local');
  const cloud = useRef<CloudStore | null>(null);
  const dirty = useRef(false);
  const saving = useRef(false);
  const queued = useRef<Workspace | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const readOnly = useRef(false);
  /** The newest snapshot not yet written to this browser. */
  const pending = useRef<Workspace | null>(null);
  // The daily data is applied only after the account copy has loaded, so it can never make a
  // stale local copy look newer than the account copy.
  const [cloudSettled, setCloudSettled] = useState(false);
  const [feed, setFeed] = useState<FeedDoc | null>(null);
  const [funds, setFunds] = useState<FundsDoc | null>(null);
  const [psx, setPsx] = useState<PsxDoc | null>(null);
  const [feedState, setFeedState] = useState<FeedCtx['state']>('loading');
  const [navUpdate, setNavUpdate] = useState<FeedCtx['navUpdate']>(null);
  const [psxUpdate, setPsxUpdate] = useState(0);

  // Connect to the private per-user store once.
  useEffect(() => {
    let alive = true;
    connectCloud()
      .then(async (store) => {
        if (!alive || !store) return;
        cloud.current = store;
        setStorage('cloud');
        const remote = await store.load();
        if (!alive) return;
        if (remote && !dirty.current) {
          setWs((local) => (Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt) || local.portfolios.every((p) => p.isExample) ? remote : local));
          setSaveStatus('saved');
        }
      })
      .finally(() => {
        if (alive) setCloudSettled(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Read the shared daily data once per visit.
  useEffect(() => {
    let alive = true;
    Promise.all([loadFeed(), loadFunds(), loadPsx()]).then(([f, fu, px]) => {
      if (!alive) return;
      setFeed(f);
      setFunds(fu);
      setPsx(px);
      setFeedState(f || fu || px ? 'ready' : 'none');
    });
    return () => {
      alive = false;
    };
  }, []);

  const flush = useCallback(async (snapshot: Workspace) => {
    const okLocal = saveLocal(snapshot);
    if (pending.current === snapshot) pending.current = null;
    const store = cloud.current;
    if (!store || readOnly.current) {
      setSaveStatus(okLocal ? 'local' : 'error');
      return;
    }
    if (saving.current) {
      queued.current = snapshot;
      return;
    }
    saving.current = true;
    setSaveStatus('saving');
    const out = await store.save(snapshot);
    saving.current = false;
    if (out === 'readonly') {
      readOnly.current = true;
      setSaveStatus('readonly');
    } else if (out === 'ok') setSaveStatus('saved');
    else setSaveStatus(out === 'too_large' ? 'too_large' : 'error');
    const next = queued.current;
    queued.current = null;
    if (next) flush(next);
  }, []);

  const schedule = useCallback((next: Workspace) => {
    dirty.current = true;
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(next), 900);
  }, [flush]);

  // Closing or reloading inside the save delay must not lose the last edit: write it to this browser at once.
  useEffect(() => {
    const onHide = () => {
      if (pending.current) saveLocal(pending.current);
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const update = useCallback((fn: (w: Workspace) => Workspace) => {
    setWs((prev) => {
      const next = { ...fn(prev), updatedAt: new Date().toISOString() };
      schedule(next);
      return next;
    });
  }, [schedule]);

  const updatePortfolio = useCallback((fn: (p: Portfolio) => Portfolio) => {
    update((w) => ({
      ...w,
      portfolios: w.portfolios.map((p) => (p.id === w.activeId ? { ...fn(p), updatedAt: new Date().toISOString() } : p)),
    }));
  }, [update]);

  const replace = useCallback((next: Workspace) => {
    const n = { ...next, updatedAt: new Date().toISOString() };
    setWs(n);
    schedule(n);
  }, [schedule]);

  /** Changes that are not the user's edits (daily data): saved, but `updatedAt` is left alone. */
  const applySilently = useCallback((fn: (w: Workspace) => Workspace | null) => {
    setWs((prev) => {
      const next = fn(prev);
      if (!next || next === prev) return prev;
      pending.current = next;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flush(next), 900);
      return next;
    });
  }, [flush]);

  const autoData = ws.settings.autoData !== false;
  useEffect(() => {
    if (!cloudSettled || !feed || !autoData) return;
    if ((ws.market.feedAt ?? '') >= feed.updatedAt) return;
    applySilently((w) => ((w.market.feedAt ?? '') >= feed.updatedAt ? null : { ...w, market: applyFeed(w.market, feed) }));
  }, [cloudSettled, feed, autoData, ws.market.feedAt, applySilently]);

  const fundSig = useMemo(
    () => ws.portfolios.map((p) => p.holdings.filter((h) => h.type === 'mutual_fund' || h.type === 'vps').map((h) => `${h.id}:${h.name}:${h.sub}:${h.feedId ?? ''}:${h.price}:${h.priceDate ?? ''}`).join('|')).join('/'),
    [ws.portfolios],
  );
  useEffect(() => {
    if (!cloudSettled || !funds || !autoData || !fundSig) return;
    const r = applyFundNavs(ws.portfolios, funds);
    if (!r.updated && !r.linked) return;
    setNavUpdate({ updated: r.updated, linked: r.linked });
    applySilently((w) => {
      const latest = applyFundNavs(w.portfolios, funds);
      return latest.updated || latest.linked ? { ...w, portfolios: latest.portfolios } : null;
    });
    // fundSig captures every fund holding field this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudSettled, funds, autoData, fundSig, applySilently]);

  const psxSig = useMemo(
    () => ws.portfolios.map((p) => p.holdings.filter((h) => h.type === 'psx_stock' || h.type === 'psx_etf').map((h) => `${h.id}:${h.ticker ?? ''}:${h.autoPrice ?? ''}:${h.price}:${h.priceDate ?? ''}:${h.priceSrc ?? ''}:${h.sector ?? ''}`).join('|')).join('/'),
    [ws.portfolios],
  );
  useEffect(() => {
    if (!cloudSettled || !psx || !autoData || !psxSig) return;
    const r = applyPsxPrices(ws.portfolios, psx);
    if (r.portfolios === ws.portfolios || r.portfolios.every((p, i) => p === ws.portfolios[i])) return;
    if (r.updated) setPsxUpdate(r.updated);
    applySilently((w) => {
      const latest = applyPsxPrices(w.portfolios, psx);
      return latest.portfolios.every((p, i) => p === w.portfolios[i]) ? null : { ...w, portfolios: latest.portfolios };
    });
    // psxSig captures every PSX holding field this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudSettled, psx, autoData, psxSig, applySilently]);

  const active = useMemo(() => ws.portfolios.find((p) => p.id === ws.activeId) ?? ws.portfolios[0], [ws]);
  const value = useMemo(() => ({ ws, active, update, updatePortfolio, replace, saveStatus, storage }), [ws, active, update, updatePortfolio, replace, saveStatus, storage]);
  const feedValue = useMemo<FeedCtx>(() => ({ state: feedState, feed, funds, psx, navUpdate, psxUpdate }), [feedState, feed, funds, psx, navUpdate, psxUpdate]);
  return (
    <WorkspaceContext.Provider value={value}>
      <FeedContext.Provider value={feedValue}>{children}</FeedContext.Provider>
    </WorkspaceContext.Provider>
  );
}

// ---------------- UI context ----------------

export interface EditorState {
  holding: Holding | null;
  type?: AssetType;
}

interface UiCtx {
  view: View;
  go: (v: View) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  aiOpen: boolean;
  setAiOpen: (b: boolean) => void;
  aiRequest: { id: number; prompt: string; send: boolean; display?: string } | null;
  askAI: (prompt: string, send?: boolean, display?: string) => void;
  toast: (msg: string) => void;
  toasts: { id: number; msg: string }[];
  editor: EditorState | null;
  openEditor: (h: Holding | null, type?: AssetType) => void;
  closeEditor: () => void;
  navOpen: boolean;
  setNavOpen: (b: boolean) => void;
  modal: string | null;
  setModal: (m: string | null) => void;
}

const UiContext = createContext<UiCtx | null>(null);

export function useUI(): UiCtx {
  const c = useContext(UiContext);
  if (!c) throw new Error('UiContext missing');
  return c;
}

function viewFromHash(): View {
  try {
    const h = (location.hash || '').replace('#', '');
    const v = (Object.keys(VIEW_HASH) as View[]).find((k) => VIEW_HASH[k] === h);
    return v ?? 'overview';
  } catch {
    return 'overview';
  }
}

export function UiProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<View>(viewFromHash);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRequest, setAiRequest] = useState<UiCtx['aiRequest']>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const seq = useRef(0);

  const go = useCallback((v: View) => {
    setView(v);
    setNavOpen(false);
    try {
      history.replaceState(null, '', '#' + VIEW_HASH[v]);
    } catch {
      /* ignore */
    }
    try {
      window.scrollTo({ top: 0 });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const toast = useCallback((msg: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, msg }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const askAI = useCallback((prompt: string, send = true, display?: string) => {
    setAiOpen(true);
    setAiRequest({ id: ++seq.current, prompt, send, display });
  }, []);

  // Adding a holding past the plan's limit asks for an upgrade instead (example portfolios are free).
  const ent = useEntitlements();
  const wsCtx = useContext(WorkspaceContext);
  const wsRef = useRef(wsCtx);
  wsRef.current = wsCtx;
  const openEditor = useCallback((h: Holding | null, type?: AssetType) => {
    const w = wsRef.current;
    if (!h && w && !w.active.isExample && ownCounts(w.ws.portfolios).holdings >= ent.limit('holdings')) {
      ent.upgrade('holdings');
      return;
    }
    setEditor({ holding: h, type });
  }, [ent]);
  const closeEditor = useCallback(() => setEditor(null), []);

  const value = useMemo(
    () => ({ view, go, filters, setFilters, aiOpen, setAiOpen, aiRequest, askAI, toast, toasts, editor, openEditor, closeEditor, navOpen, setNavOpen, modal, setModal }),
    [view, go, filters, aiOpen, aiRequest, askAI, toast, toasts, editor, openEditor, closeEditor, navOpen, modal],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

/** Holdings of the active portfolio after global filters. */
export function useFilteredHoldings(): Holding[] {
  const { active } = useWS();
  const { filters } = useUI();
  return useMemo(() => applyFilters(active.holdings, filters), [active.holdings, filters]);
}

// ---------------- Theme colors for charts ----------------

export interface ChartColors {
  dark: boolean;
  series: string[];
  other: string;
  grid: string;
  axis: string;
  text: string;
  ink: string;
  ink2: string;
  ink3: string;
  surface: string;
  surface2: string;
  line: string;
  accent: string;
  good: string;
  warn: string;
  serious: string;
  critical: string;
  font: string;
}

function readColors(): ChartColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => (cs.getPropertyValue(n).trim() || fb);
  const surface = v('--surface', '#ffffff');
  return {
    dark: isDarkHex(surface),
    series: ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'].map((n, i) => v(n, ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'][i])),
    other: v('--c-other', '#98a1b3'),
    grid: v('--grid', '#e8ebf1'),
    axis: v('--axis', '#c9d0dc'),
    text: v('--chart-text', '#5f6985'),
    ink: v('--ink', '#0c1322'),
    ink2: v('--ink-2', '#475069'),
    ink3: v('--ink-3', '#5f6985'),
    surface,
    surface2: v('--surface-2', '#f7f8fb'),
    line: v('--line', '#e2e6ee'),
    accent: v('--accent', '#2443c8'),
    good: '#0ca30c',
    warn: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b',
    font: v('--font-ui', 'system-ui, sans-serif'),
  };
}

function isDarkHex(c: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
}

const ColorContext = createContext<ChartColors | null>(null);

export function ColorProvider({ children }: { children: React.ReactNode }) {
  const [colors, setColors] = useState<ChartColors>(() => readColors());
  useEffect(() => {
    const refresh = () => setColors(readColors());
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    mq?.addEventListener?.('change', refresh);
    const mo = new MutationObserver(refresh);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    // Fonts may arrive after first paint; refresh once they are ready so charts pick them up.
    (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(refresh).catch(() => undefined);
    return () => {
      mq?.removeEventListener?.('change', refresh);
      mo.disconnect();
    };
  }, []);
  return <ColorContext.Provider value={colors}>{children}</ColorContext.Provider>;
}

export function useColors(): ChartColors {
  const c = useContext(ColorContext);
  if (!c) throw new Error('ColorContext missing');
  return c;
}
