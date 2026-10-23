// The back office at /admin: one screen per area, a sidebar to move between them.
import React, { useEffect, useState } from 'react';
import { useAccount } from '../session';
import { BrandMark, Icon } from '../../ui/components/Icon';
import { Button } from '../../ui/components/primitives';
import { Dashboard } from './dashboard';
import { Users } from './users';
import { Billing } from './billing';
import { Market } from './market';
import { Messages } from './messages';
import { Settings } from './settings';

type Section = 'dashboard' | 'users' | 'billing' | 'market' | 'messages' | 'settings';

const NAV: { id: Section; label: string; icon: string; sub: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'overview', sub: 'Users, revenue, AI cost and jobs at a glance' },
  { id: 'users', label: 'Users', icon: 'users', sub: 'Find a person, see their plan and usage, help them' },
  { id: 'billing', label: 'Billing', icon: 'card', sub: 'Subscriptions, payments, plans and gift codes' },
  { id: 'market', label: 'Market data', icon: 'database', sub: 'What everyone sees, and corrections' },
  { id: 'messages', label: 'Messages', icon: 'message', sub: 'Feedback, announcements and email' },
  { id: 'settings', label: 'Settings', icon: 'settings', sub: 'Switches, keys status and the audit log' },
];

function fromHash(): Section {
  const h = window.location.hash.replace('#', '') as Section;
  return NAV.some((n) => n.id === h) ? h : 'dashboard';
}

export function AdminApp() {
  const a = useAccount();
  const [section, setSection] = useState<Section>(fromHash);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const on = () => setSection(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (s: Section) => {
    setSection(s);
    setNavOpen(false);
    history.replaceState(null, '', `#${s}`);
    window.scrollTo({ top: 0 });
  };
  const cur = NAV.find((n) => n.id === section)!;
  return (
    <div className="app w-admin">
      {navOpen && <div className="scrim mobile-only" style={{ zIndex: 29 }} onClick={() => setNavOpen(false)} />}
      <nav className={'sidebar' + (navOpen ? ' open' : '')} aria-label="Back office">
        <a className="brand" href="/admin">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-name">Arzish</span>
            <div className="brand-sub">Back office</div>
          </span>
        </a>
        <div className="nav-group">
          {NAV.map((n) => (
            <button key={n.id} type="button" className="nav-item" aria-current={section === n.id ? 'page' : undefined} onClick={() => go(n.id)} title={n.label}>
              <Icon name={n.icon} />
              <span className="nav-label">{n.label}</span>
            </button>
          ))}
        </div>
        <div className="side-foot">
          <a className="nav-item" href="/app"><Icon name="chevronRight" /><span className="nav-label">Open the app</span></a>
          <div className="sf-text tiny muted" style={{ padding: '0 10px' }}>Signed in as {a.email}</div>
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <Button className="menu-btn" variant="ghost" iconOnly icon="menu" onClick={() => setNavOpen(true)}>Open menu</Button>
          <div style={{ minWidth: 0 }}>
            <div className="strong">{cur.label}</div>
            <div className="tiny muted hide-sm">{cur.sub}</div>
          </div>
          <div className="spacer" />
          <Button variant="ghost" icon="logout" onClick={a.signOut}>Sign out</Button>
        </header>
        <main className="content" id="main">
          {section === 'dashboard' && <Dashboard />}
          {section === 'users' && <Users />}
          {section === 'billing' && <Billing />}
          {section === 'market' && <Market />}
          {section === 'messages' && <Messages />}
          {section === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}
