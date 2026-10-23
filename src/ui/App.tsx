import React, { useEffect, useRef } from 'react';
import { ColorProvider, UiProvider, useUI, useWS, WorkspaceProvider, type View } from '../state/store';
import { AIDrawer } from './ai/AIDrawer';
import { FilterBar, Sidebar, Toasts, Topbar } from './Shell';
import { Allocation } from './views/Allocation';
import { Compare } from './views/Compare';
import { Forecast } from './views/Forecast';
import { Goals } from './views/Goals';
import { HoldingEditor } from './views/HoldingEditor';
import { Holdings } from './views/Holdings';
import { Income } from './views/Income';
import { Insights } from './views/Insights';
import { Markets } from './views/Markets';
import { Optimizer } from './views/Optimizer';
import { Overview } from './views/Overview';
import { Risk } from './views/Risk';
import { SettingsView } from './views/Settings';
import { Stress } from './views/Stress';
import { TaxZakat } from './views/TaxZakat';
import { Icon } from './components/Icon';
import { PRO_VIEWS, useEntitlements } from '../state/entitlements';
import { useSlots } from '../state/slots';

const VIEW_COMPONENTS: Record<View, () => React.ReactElement | null> = {
  overview: Overview,
  holdings: Holdings,
  allocation: Allocation,
  income: Income,
  forecast: Forecast,
  goals: Goals,
  compare: Compare,
  risk: Risk,
  stress: Stress,
  optimizer: Optimizer,
  tax: TaxZakat,
  markets: Markets,
  insights: Insights,
  settings: SettingsView,
};

const NO_FILTERS: View[] = ['markets', 'settings', 'insights', 'compare'];

class Boundary extends React.Component<{ children: React.ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  componentDidCatch(error: Error) {
    console.error('View error', error);
  }
  render() {
    if (this.state.error)
      return (
        <div className="card" style={{ padding: 20 }}>
          <div className="row"><Icon name="alert" size={18} /><strong>This screen hit an error.</strong></div>
          <p className="small ink2" style={{ marginTop: 6 }}>{this.state.error.message}. Your data is safe; switch screens or reload the page.</p>
        </div>
      );
    return this.props.children;
  }
}

// The viewer may set its own theme attribute; remember it so "System" can hand control back.
const HOST_THEME = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;

function useThemeSetting() {
  const { ws } = useWS();
  const theme = ws.settings.theme;
  const first = useRef(true);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'light' || theme === 'dark') el.setAttribute('data-theme', theme);
    else if (!first.current) {
      if (HOST_THEME) el.setAttribute('data-theme', HOST_THEME);
      else el.removeAttribute('data-theme');
    }
    first.current = false;
  }, [theme]);
}

function Layout() {
  const { view, editor, aiOpen } = useUI();
  const ent = useEntitlements();
  const slots = useSlots();
  useThemeSetting();
  const ViewComp = VIEW_COMPONENTS[view] ?? Overview;
  const locked = PRO_VIEWS.includes(view) && !ent.can('pro_screens') && ent.locked ? ent.locked(view) : null;
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar />
        {!NO_FILTERS.includes(view) && <FilterBar />}
        <main className="content" id="main">
          {slots.banner}
          <Boundary resetKey={view}>
            {locked ?? <ViewComp />}
          </Boundary>
        </main>
      </div>
      {aiOpen && <AIDrawer />}
      {editor && <HoldingEditor key={editor.holding?.id ?? editor.type ?? 'new'} />}
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <WorkspaceProvider>
      <UiProvider>
        <ColorProvider>
          <Layout />
        </ColorProvider>
      </UiProvider>
    </WorkspaceProvider>
  );
}
