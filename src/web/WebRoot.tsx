// Routes of the web app: /signin, /admin (back office) and /app (the analyzer, signed in or as a
// browser-only demo). The marketing pages are static files served alongside.
import React, { useCallback, useEffect, useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AccountProvider, signInUrl, useAccount, useWebEntitlements, type AccountTab } from './session';
import { Banners, Locked, PerformanceCard, TopbarExtras } from './chrome';
import { AccountModal } from './account';
import { UpgradeModal } from './upgrade';
import { SignIn } from './signin';
import { AdminApp } from './admin';
import { setAiLimits } from './runtime';
import { App } from '../ui/App';
import { ColorProvider, type View } from '../state/store';
import { EntitlementsContext } from '../state/entitlements';
import { SlotsContext } from '../state/slots';
import { BrandMark } from '../ui/components/Icon';

function Splash({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="w-splash">
      <BrandMark size={34} />
      <div className="small muted">{text}</div>
    </div>
  );
}

function Dialogs() {
  const a = useAccount();
  if (!a.dialog) return null;
  if (a.dialog.kind === 'account') return <AccountModal tab={a.dialog.tab} onClose={a.closeDialog} />;
  return <UpgradeModal reason={a.dialog.reason} onClose={a.closeDialog} />;
}

const HASH_TABS: Record<string, AccountTab> = { notifications: 'notifications', billing: 'plan', plan: 'plan', feedback: 'help', help: 'help', account: 'plan', invite: 'invite', alerts: 'alerts' };

function AppScreen() {
  const a = useAccount();
  const locked = useCallback((v: View) => <Locked view={v} />, []);
  const ent = useWebEntitlements(locked);
  const slots = useMemo(() => ({ topbar: <TopbarExtras />, banner: <Banners />, overview: <PerformanceCard /> }), []);

  // Links from emails: /app#notifications, /app#billing.
  useEffect(() => {
    if (a.status !== 'signedIn') return;
    const tab = HASH_TABS[window.location.hash.replace('#', '')];
    if (tab) {
      a.openAccount(tab);
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.status]);

  useEffect(() => setAiLimits({ images: !!a.plan.limits.import }), [a.plan]);

  if (a.status === 'loading') return <Splash text="Opening your portfolio…" />;
  return (
    <EntitlementsContext.Provider value={ent}>
      <SlotsContext.Provider value={slots}>
        <App />
      </SlotsContext.Provider>
    </EntitlementsContext.Provider>
  );
}

function AdminGate() {
  const a = useAccount();
  useEffect(() => {
    if (a.status === 'signedOut') window.location.assign(signInUrl('/admin'));
  }, [a.status]);
  if (a.status !== 'signedIn') return <Splash />;
  if (!a.profile) return <Splash />;
  if (!a.isAdmin) {
    return (
      <div className="w-splash">
        <BrandMark size={34} />
        <div className="strong">The back office is for Arzish admins.</div>
        <a className="btn" href="/app">Open the app</a>
      </div>
    );
  }
  return (
    <ColorProvider>
      <AdminApp />
    </ColorProvider>
  );
}

export function WebRoot({ session }: { session: Session | null }) {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/signin') {
    if (session) {
      const next = new URLSearchParams(window.location.search).get('next') ?? '/app';
      window.location.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/app');
      return <Splash />;
    }
    return <SignIn />;
  }
  return (
    <AccountProvider initial={session}>
      {path.startsWith('/admin') ? <AdminGate /> : <AppScreen />}
      <Dialogs />
    </AccountProvider>
  );
}
