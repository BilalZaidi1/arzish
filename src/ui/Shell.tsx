import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CLASS_META } from '../engine/catalog';
import { fmtDate } from '../engine/format';
import { EXAMPLE_BUILDERS, emptyPortfolio } from '../engine/samples';
import type { AssetClass, Portfolio } from '../engine/types';
import { CLASS_ORDER, DEFAULT_FILTERS } from '../engine/types';
import { filtersActive, holdingClass } from '../engine/valuation';
import { useFeed, useFilteredHoldings, useUI, useWS, type View } from '../state/store';
import { BrandMark, Icon } from './components/Icon';
import { Badge, Button, Chip, Modal, Seg } from './components/primitives';
import { useColors, classColor } from './charts/base';
import { uid } from '../engine/format';
import { ownCounts, useEntitlements } from '../state/entitlements';
import { useSlots } from '../state/slots';

const NAV: { group: string; items: { view: View; label: string; icon: string }[] }[] = [
  { group: 'Portfolio', items: [
    { view: 'overview', label: 'Overview', icon: 'overview' },
    { view: 'holdings', label: 'Holdings', icon: 'holdings' },
    { view: 'allocation', label: 'Allocation', icon: 'allocation' },
    { view: 'income', label: 'Income', icon: 'income' },
  ] },
  { group: 'Planning', items: [
    { view: 'forecast', label: 'Forecast', icon: 'forecast' },
    { view: 'goals', label: 'Goals', icon: 'goals' },
    { view: 'compare', label: 'Compare', icon: 'compare' },
  ] },
  { group: 'Risk', items: [
    { view: 'risk', label: 'Risk', icon: 'risk' },
    { view: 'stress', label: 'Stress tests', icon: 'stress' },
    { view: 'optimizer', label: 'Optimizer', icon: 'optimizer' },
  ] },
  { group: 'Tools', items: [
    { view: 'tax', label: 'Tax & zakat', icon: 'tax' },
    { view: 'markets', label: 'Markets & assumptions', icon: 'markets' },
    { view: 'insights', label: 'AI insights', icon: 'insights' },
  ] },
];

export function Sidebar() {
  const { view, go, navOpen, setNavOpen } = useUI();
  const { ws, saveStatus, storage } = useWS();
  const status = {
    idle: storage === 'cloud' ? 'Synced to your account' : 'Saved in this browser',
    saving: 'Saving…',
    saved: 'Saved to your account',
    local: 'Saved in this browser',
    readonly: 'View-only here: saved in this browser',
    error: 'Could not save. Export a backup.',
    too_large: 'Workspace too large to sync',
  }[saveStatus];
  return (
    <>
      {navOpen && <div className="scrim mobile-only" style={{ zIndex: 29 }} onClick={() => setNavOpen(false)} />}
      <nav className={'sidebar' + (navOpen ? ' open' : '')} aria-label="Main">
        <a className="brand" href="#overview" onClick={(e) => { e.preventDefault(); go('overview'); }}>
          <BrandMark />
          <span className="brand-text">
            <span className="brand-name">Arzish</span>
            <div className="brand-sub">Portfolio forecast analyzer</div>
          </span>
        </a>
        {NAV.map((g) => (
          <div className="nav-group" key={g.group}>
            <div className="eyebrow">{g.group}</div>
            {g.items.map((it) => (
              <button key={it.view} type="button" className="nav-item" aria-current={view === it.view ? 'page' : undefined} onClick={() => go(it.view)} title={it.label}>
                <Icon name={it.icon} />
                <span className="nav-label">{it.label}</span>
              </button>
            ))}
          </div>
        ))}
        <div className="side-foot">
          <button type="button" className="nav-item" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => go('settings')} title="Settings">
            <Icon name="settings" />
            <span className="nav-label">Settings</span>
          </button>
          <div className="sf-text tiny muted" style={{ padding: '0 10px' }}>
            <div>{status}</div>
            <div>Market data as of {fmtDate(ws.market.asOf)}</div>
          </div>
        </div>
      </nav>
    </>
  );
}

function PortfolioMenu() {
  const { ws, update, active, replace } = useWS();
  const { toast, go } = useUI();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<null | 'rename' | 'delete' | 'examples'>(null);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const ent = useEntitlements();
  const addPortfolio = (p: Portfolio) => {
    update((w) => ({ ...w, portfolios: [...w.portfolios, p], activeId: p.id }));
  };
  // New and duplicated portfolios count toward the plan; examples do not.
  const roomFor = (n = 1): boolean => {
    const c = ownCounts(ws.portfolios);
    if (c.portfolios + n > ent.limit('portfolios')) {
      ent.upgrade('portfolios');
      return false;
    }
    return true;
  };
  const items: { label: string; icon: string; run: () => void; danger?: boolean }[] = [
    { label: 'New empty portfolio', icon: 'plus', run: () => { if (!roomFor()) return; addPortfolio(emptyPortfolio(`Portfolio ${ws.portfolios.length + 1}`)); toast('Empty portfolio created'); go('holdings'); } },
    { label: 'Duplicate this portfolio', icon: 'copy', run: () => {
      if (!roomFor()) return;
      const copy: Portfolio = JSON.parse(JSON.stringify(active));
      copy.id = uid('p');
      copy.name = active.name.replace(/^Example: /, '') + ' (copy)';
      copy.isExample = false;
      copy.holdings = copy.holdings.map((h) => ({ ...h, id: uid('h') }));
      addPortfolio(copy);
      toast('Portfolio duplicated');
    } },
    { label: 'Load an example', icon: 'file', run: () => setDialog('examples') },
    { label: 'Rename', icon: 'edit', run: () => { setName(active.name); setDialog('rename'); } },
    { label: 'Delete this portfolio', icon: 'trash', danger: true, run: () => setDialog('delete') },
  ];
  return (
    <div className="pf-switch" ref={ref}>
      <select className="select" aria-label="Portfolio" value={ws.activeId} onChange={(e) => update((w) => ({ ...w, activeId: e.target.value }))}>
        {ws.portfolios.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <div style={{ position: 'relative' }}>
        <Button iconOnly icon="chevronDown" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Portfolio actions</Button>
        {open && (
          <div role="menu" style={{ position: 'absolute', top: 40, left: 0, zIndex: 40, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-2)', padding: 6, minWidth: 230 }}>
            {items.map((it) => (
              <button key={it.label} role="menuitem" type="button" className="nav-item" style={{ color: it.danger ? 'var(--critical-ink)' : undefined }} onClick={() => { setOpen(false); it.run(); }}>
                <Icon name={it.icon} />
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {active.isExample && <span className="hide-sm"><Badge tone="example">Example</Badge></span>}
      {dialog === 'rename' && (
        <Modal title="Rename portfolio" onClose={() => setDialog(null)} footer={<>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => {
            const n = name.trim();
            if (n) update((w) => ({ ...w, portfolios: w.portfolios.map((p) => (p.id === active.id ? { ...p, name: n } : p)) }));
            setDialog(null);
          }}>Save</Button>
        </>}>
          <div className="field">
            <label htmlFor="pf-name">Name</label>
            <input id="pf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
        </Modal>
      )}
      {dialog === 'delete' && (
        <Modal title="Delete this portfolio?" onClose={() => setDialog(null)} footer={<>
          <Button onClick={() => setDialog(null)}>Keep it</Button>
          <Button variant="danger" onClick={() => {
            if (ws.portfolios.length <= 1) {
              const fresh = emptyPortfolio('My portfolio');
              replace({ ...ws, portfolios: [fresh], activeId: fresh.id });
            } else {
              update((w) => {
                const rest = w.portfolios.filter((p) => p.id !== active.id);
                return { ...w, portfolios: rest, activeId: rest[0].id };
              });
            }
            setDialog(null);
            toast('Portfolio deleted');
          }}>Delete</Button>
        </>}>
          <p>“{active.name}” and its holdings, goals and saved scenarios will be removed. Export a backup from Settings first if you may need it.</p>
        </Modal>
      )}
      {dialog === 'examples' && (
        <Modal title="Load an example portfolio" onClose={() => setDialog(null)}>
          <div className="stack">
            <p className="ink2 small">Examples use illustrative prices. They are added next to your portfolios, never over them.</p>
            {EXAMPLE_BUILDERS.map((e) => (
              <button key={e.key} type="button" className="type-btn" onClick={() => { addPortfolio(e.build()); setDialog(null); toast(`Loaded example: ${e.label}`); }}>
                <span className="tb-name">{e.label}</span>
                <span className="tb-hint">{e.blurb}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Topbar() {
  const { ws, update } = useWS();
  const slots = useSlots();
  const { setNavOpen, setAiOpen, aiOpen } = useUI();
  const s = ws.settings;
  const set = (patch: Partial<typeof s>) => update((w) => ({ ...w, settings: { ...w.settings, ...patch } }));
  return (
    <header className="topbar">
      <Button className="menu-btn" variant="ghost" iconOnly icon="menu" onClick={() => setNavOpen(true)}>Open menu</Button>
      <PortfolioMenu />
      <div className="spacer" />
      <Seg label="Base currency" value={s.baseCurrency} onChange={(v) => set({ baseCurrency: v })} options={[{ value: 'PKR', label: 'PKR' }, { value: 'USD', label: 'USD' }]} />
      <span className="hide-sm">
        <Seg label="Values" value={s.realTerms ? 'real' : 'nominal'} onChange={(v) => set({ realTerms: v === 'real' })} options={[{ value: 'nominal', label: 'Nominal', title: 'Future values in future rupees' }, { value: 'real', label: "Today's money", title: 'Future values adjusted for inflation' }]} />
      </span>
      <span className="hide-sm">
        <Seg label="Number style" value={s.numberStyle} onChange={(v) => set({ numberStyle: v })} options={[{ value: 'lakh', label: 'Lakh·Cr', title: 'Lakh and crore' }, { value: 'intl', label: 'M·B', title: 'Thousands, millions, billions' }]} />
      </span>
      <Button variant="ai" icon="sparkle" onClick={() => setAiOpen(!aiOpen)} aria-pressed={aiOpen}>Ask AI</Button>
      {slots.topbar}
    </header>
  );
}

export function FilterBar() {
  const { active } = useWS();
  const { filters, setFilters } = useUI();
  const filtered = useFilteredHoldings();
  const colors = useColors();
  const present = useMemo(() => CLASS_ORDER.filter((c) => active.holdings.some((h) => holdingClass(h) === c)), [active.holdings]);
  const accounts = useMemo(() => Array.from(new Set(active.holdings.map((h) => h.account ?? 'Self'))), [active.holdings]);
  const toggleClass = (c: AssetClass) => {
    const has = filters.classes.includes(c);
    setFilters({ ...filters, classes: has ? filters.classes.filter((x) => x !== c) : [...filters.classes, c] });
  };
  const on = filtersActive(filters);
  return (
    <div className="filterbar" role="region" aria-label="Filters">
      <Icon name="filter" size={16} className="muted" />
      {present.map((c) => (
        <Chip key={c} pressed={filters.classes.includes(c)} onClick={() => toggleClass(c)} color={classColor(colors, CLASS_META[c].slot)}>
          {CLASS_META[c].short}
        </Chip>
      ))}
      <span className="sep" />
      <Seg size="sm" label="Currency" value={filters.currency} onChange={(v) => setFilters({ ...filters, currency: v })} options={[{ value: 'all', label: 'Any currency' }, { value: 'pkr', label: 'PKR' }, { value: 'foreign', label: 'Foreign' }]} />
      <Seg size="sm" label="Liquidity" value={filters.liquidity} onChange={(v) => setFilters({ ...filters, liquidity: v })} options={[{ value: 'all', label: 'Any liquidity' }, { value: 'liquid', label: 'Liquid' }, { value: 'illiquid', label: 'Illiquid' }]} />
      <Chip pressed={filters.shariah === 'yes'} onClick={() => setFilters({ ...filters, shariah: filters.shariah === 'yes' ? 'all' : 'yes' })} title="Show only Shariah-compliant holdings">Shariah only</Chip>
      {accounts.length > 1 && (
        <select className="select" aria-label="Account" style={{ width: 'auto', height: 28, fontSize: 12.5 }} value={filters.account} onChange={(e) => setFilters({ ...filters, account: e.target.value })}>
          <option value="all">All accounts</option>
          {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}
      {on && <button type="button" className="linkbtn small nowrap" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</button>}
      <span className="filter-note small muted">{on ? `${filtered.length} of ${active.holdings.length} holdings` : `${active.holdings.length} holdings`}</span>
    </div>
  );
}

export function Toasts() {
  const { toasts, toast } = useUI();
  const { navUpdate, psxUpdate } = useFeed();
  // Say once per visit when fund NAVs or PSX prices were refreshed, or funds newly linked.
  useEffect(() => {
    if (!navUpdate) return;
    const parts: string[] = [];
    if (navUpdate.updated) parts.push(`${navUpdate.updated} fund NAV${navUpdate.updated === 1 ? '' : 's'} updated`);
    if (navUpdate.linked) parts.push(`${navUpdate.linked} fund${navUpdate.linked === 1 ? '' : 's'} linked to MUFAP's daily NAVs`);
    if (parts.length) toast(parts.join(' · '));
  }, [navUpdate, toast]);
  useEffect(() => {
    if (psxUpdate) toast(`${psxUpdate} PSX price${psxUpdate === 1 ? '' : 's'} updated`);
  }, [psxUpdate, toast]);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>{t.msg}</div>
      ))}
    </div>
  );
}
