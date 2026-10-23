// Web-edition controls placed inside the shared app: notification bell, account menu, banners,
// the locked screen for paid views, and the performance card on the Overview.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sb } from './supabase';
import { daysLeft, useAccount } from './session';
import { DEMO_KEY } from './config';
import { useUI, useWS, VIEW_HASH, type View } from '../state/store';
import { migrateWorkspace } from '../engine/samples';
import { fmtDate } from '../engine/format';
import { Icon } from '../ui/components/Icon';
import { Badge, Button, Card, Spinner } from '../ui/components/primitives';
import { MultiLineChart } from '../ui/charts/charts';
import { useColors } from '../ui/charts/base';
import { useFmt } from '../ui/fmt';
import { PageHead } from '../ui/views/common';

interface Notice {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso.slice(0, 10));
}

const KIND_ICON: Record<string, string> = {
  maturity: 'calendar', policy_rate: 'markets', nss_rate: 'markets', ex_dividend: 'income', fund_stale: 'alert',
  price_alert: 'bolt', drawdown: 'risk', zakat: 'tax', tax: 'tax', announcement: 'info', billing: 'card', feedback_reply: 'message', account: 'user',
};

/** Follow a notification link: a screen of the app, or a tab of the account dialog. */
export function useFollowLink(): (link: string | null | undefined) => void {
  const { go } = useUI();
  const a = useAccount();
  return useCallback((link) => {
    if (!link) return;
    const h = link.replace(/^.*#/, '');
    const view = (Object.keys(VIEW_HASH) as View[]).find((v) => VIEW_HASH[v] === h);
    if (view) return go(view);
    if (h === 'billing') return a.openAccount('plan');
    if (h === 'notifications') return a.openAccount('notifications');
    if (h === 'feedback') return a.openAccount('help');
    if (/^https?:\/\//.test(link)) window.open(link, '_blank', 'noopener');
  }, [go, a]);
}

function Bell() {
  const a = useAccount();
  const follow = useFollowLink();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties | undefined>(undefined);
  const [items, setItems] = useState<Notice[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const unread = (items ?? []).filter((n) => !n.read_at).length;

  // On a phone the bell is not at the screen edge, so the panel is pinned to the viewport instead.
  const toggle = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!open && r && window.innerWidth <= 640) {
      const top = Math.round(r.bottom + 8);
      setPos({ position: 'fixed', top, left: 8, right: 8, width: 'auto', maxHeight: `calc(100dvh - ${top + 16}px)` });
    } else {
      setPos(undefined);
    }
    setOpen(!open);
  };

  const load = useCallback(async () => {
    const { data } = await sb.from('notifications').select('id, kind, title, body, link, created_at, read_at').order('created_at', { ascending: false }).limit(40);
    setItems((data ?? []) as Notice[]);
  }, []);

  useEffect(() => {
    if (!a.userId) return;
    load();
    const ch = sb
      .channel(`notifications-${a.userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${a.userId}` }, (p) => {
        setItems((list) => [p.new as Notice, ...(list ?? []).filter((n) => n.id !== (p.new as Notice).id)].slice(0, 40));
      })
      .subscribe();
    const t = window.setInterval(load, 5 * 60_000);
    return () => {
      sb.removeChannel(ch);
      window.clearInterval(t);
    };
  }, [a.userId, load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markRead = async (ids: number[]) => {
    if (!ids.length) return;
    const now = new Date().toISOString();
    setItems((list) => (list ?? []).map((n) => (ids.includes(n.id) ? { ...n, read_at: now } : n)));
    await sb.from('notifications').update({ read_at: now }).in('id', ids);
  };

  return (
    <div className="w-pop" ref={ref}>
      <Button variant="ghost" iconOnly icon="bell" aria-expanded={open} onClick={toggle}>{unread ? `${unread} unread notifications` : 'Notifications'}</Button>
      {unread > 0 && <span className="w-dot" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      {open && (
        <div className="w-panel" role="dialog" aria-label="Notifications" style={pos}>
          <div className="w-panel-h">
            <strong>Notifications</strong>
            <div className="row" style={{ gap: 4 }}>
              {unread > 0 && <button type="button" className="linkbtn small" onClick={() => markRead((items ?? []).filter((n) => !n.read_at).map((n) => n.id))}>Mark all read</button>}
              <Button size="sm" variant="ghost" iconOnly icon="settings" onClick={() => { setOpen(false); a.openAccount('notifications'); }}>Notification settings</Button>
            </div>
          </div>
          <div className="w-panel-b">
            {items === null && <div className="row small muted" style={{ padding: 16 }}><Spinner /> Loading…</div>}
            {items && items.length === 0 && (
              <div className="empty" style={{ padding: '22px 12px' }}>
                <Icon name="bell" />
                <div className="small">Nothing yet. Maturity reminders, rate changes and alerts on your holdings appear here.</div>
              </div>
            )}
            {items?.map((n) => (
              <button key={n.id} type="button" className={'w-note' + (n.read_at ? '' : ' unread')} onClick={() => { markRead([n.id]); setOpen(false); follow(n.link); }}>
                <span className="w-note-i"><Icon name={KIND_ICON[n.kind] ?? 'info'} size={16} /></span>
                <span className="w-note-t">
                  <span className="w-note-title">{n.title}</span>
                  {n.body && <span className="w-note-body">{n.body}</span>}
                  <span className="w-note-time">{ago(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountMenu() {
  const a = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const name = a.profile?.full_name || a.email || 'Account';
  const initial = (name.trim()[0] ?? 'A').toUpperCase();
  const trial = a.plan.status === 'trialing';
  const paid = a.plan.plan !== 'free' && !trial;
  const items: { label: string; icon: string; run: () => void }[] = [
    { label: 'Plan and billing', icon: 'card', run: () => a.openAccount('plan') },
    { label: 'Notifications and alerts', icon: 'bell', run: () => a.openAccount('notifications') },
    { label: 'Profile and data', icon: 'user', run: () => a.openAccount('profile') },
    { label: 'Invite friends', icon: 'gift', run: () => a.openAccount('invite') },
    { label: 'Help and feedback', icon: 'message', run: () => a.openAccount('help') },
    ...(a.isAdmin ? [{ label: 'Back office', icon: 'shield', run: () => window.location.assign('/admin') }] : []),
    { label: 'Sign out', icon: 'logout', run: () => a.signOut() },
  ];
  return (
    <div className="w-pop" ref={ref}>
      <button type="button" className="w-avatar-btn" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((o) => !o)}>
        <span className="w-avatar" aria-hidden="true">{initial}</span>
        <span className="w-plan hide-sm">{trial ? 'Pro trial' : a.plan.name}</span>
      </button>
      {open && (
        <div className="w-menu" role="menu">
          <div className="w-menu-h">
            <div className="strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
            {a.profile?.full_name && <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.email}</div>}
            <div className="row" style={{ marginTop: 6, gap: 6 }}>
              <Badge tone="accent">{trial ? `Pro trial · ${daysLeft(a.plan.periodEnd) ?? 0} days left` : a.plan.name}</Badge>
            </div>
          </div>
          {!paid && (
            <div style={{ padding: '4px 6px 6px' }}>
              <Button variant="primary" size="sm" icon="bolt" onClick={() => { setOpen(false); a.openUpgrade('general'); }} className="w-full">Upgrade to Pro</Button>
            </div>
          )}
          {items.map((it) => (
            <button key={it.label} role="menuitem" type="button" className="nav-item" onClick={() => { setOpen(false); it.run(); }}>
              <Icon name={it.icon} />
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopbarExtras() {
  const a = useAccount();
  if (a.status === 'signedOut') {
    return <Button variant="primary" icon="user" onClick={a.goSignIn}>Sign in</Button>;
  }
  return (
    <>
      <Bell />
      <AccountMenu />
    </>
  );
}

// ------------------------------------------------------------------ banners

interface Announcement {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  audience: string;
}

function readDismissed(): number[] {
  try {
    return JSON.parse(localStorage.getItem('arzish.ann.dismissed') ?? '[]');
  } catch {
    return [];
  }
}

export function Banners() {
  const a = useAccount();
  const { ws, replace } = useWS();
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<number[]>(readDismissed);
  const [checkout, setCheckout] = useState<'success' | 'cancelled' | null>(null);
  const [demo, setDemo] = useState<ReturnType<typeof migrateWorkspace>>(null);

  // Return from the payment page.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const b = q.get('billing');
    if (b === 'success' || b === 'cancelled') {
      setCheckout(b);
      q.delete('billing');
      q.delete('ref');
      const rest = q.toString();
      history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    }
  }, []);
  useEffect(() => {
    if (checkout !== 'success' || a.plan.status === 'active') return;
    let n = 0;
    const t = window.setInterval(() => {
      n++;
      a.refresh();
      if (n > 20) window.clearInterval(t);
    }, 3000);
    return () => window.clearInterval(t);
  }, [checkout, a.plan.status, a]);

  useEffect(() => {
    if (a.status !== 'signedIn') return;
    sb.from('announcements').select('id, title, body, link, audience').order('starts_at', { ascending: false }).limit(5).then(({ data }) => setAnns((data ?? []) as Announcement[]));
  }, [a.status]);

  // A portfolio started without an account, offered once after signing in.
  useEffect(() => {
    if (a.status !== 'signedIn' || !a.userId) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(DEMO_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    const w = migrateWorkspace(JSON.parse(raw));
    if (!w || !w.portfolios.some((p) => !p.isExample && p.holdings.length > 0)) return;
    const mine = ws.portfolios.some((p) => !p.isExample && p.holdings.length > 0);
    if (!mine) setDemo(w);
  }, [a.status, a.userId, ws.portfolios]);

  const dropDemo = () => {
    try {
      localStorage.removeItem(DEMO_KEY);
    } catch {
      /* ignore */
    }
    setDemo(null);
  };

  const paid = a.plan.plan !== 'free' && a.plan.status !== 'trialing';
  const visible = anns.filter((x) => !dismissed.includes(x.id) && (x.audience === 'all' || (x.audience === 'paid') === paid));
  const trialDays = a.plan.status === 'trialing' ? daysLeft(a.plan.periodEnd) : null;
  const out: React.ReactNode[] = [];

  if (a.status === 'signedOut') {
    out.push(
      <div className="w-banner" key="demo">
        <Icon name="info" size={16} />
        <div className="w-banner-t">You are trying Arzish without an account. Your portfolio stays in this browser. Sign in, free, to save it, get maturity and rate alerts, and use the AI analyst.</div>
        <Button size="sm" variant="primary" onClick={a.goSignIn}>Sign in</Button>
      </div>,
    );
  }
  if (demo) {
    out.push(
      <div className="w-banner accent" key="import">
        <Icon name="upload" size={16} />
        <div className="w-banner-t">You started a portfolio before signing in. Bring it into your account?</div>
        <Button size="sm" variant="primary" onClick={() => { replace(demo); dropDemo(); }}>Bring it in</Button>
        <Button size="sm" variant="ghost" onClick={dropDemo}>Discard</Button>
      </div>,
    );
  }
  if (checkout === 'success') {
    out.push(
      <div className="w-banner good" key="paid">
        <Icon name="check" size={16} />
        <div className="w-banner-t">{a.plan.status === 'active' && a.plan.plan !== 'free' ? `Payment received. ${a.plan.name} is active. Thank you.` : 'Payment received. Your plan switches on in a moment.'}</div>
        <Button size="sm" variant="ghost" iconOnly icon="close" onClick={() => setCheckout(null)}>Dismiss</Button>
      </div>,
    );
  }
  if (checkout === 'cancelled') {
    out.push(
      <div className="w-banner" key="cancel">
        <Icon name="info" size={16} />
        <div className="w-banner-t">Checkout cancelled. You have not been charged.</div>
        <Button size="sm" variant="ghost" iconOnly icon="close" onClick={() => setCheckout(null)}>Dismiss</Button>
      </div>,
    );
  }
  if (a.plan.status === 'past_due') {
    out.push(
      <div className="w-banner warn" key="pastdue">
        <Icon name="alert" size={16} />
        <div className="w-banner-t">Your last payment did not go through. Pro stays on for a few days while you sort it out.</div>
        <Button size="sm" onClick={() => a.openAccount('plan')}>Billing</Button>
      </div>,
    );
  }
  if (trialDays !== null && trialDays <= 5) {
    out.push(
      <div className="w-banner accent" key="trial">
        <Icon name="bolt" size={16} />
        <div className="w-banner-t">{trialDays === 0 ? 'Your Pro trial ends today.' : `Your Pro trial ends in ${trialDays} day${trialDays === 1 ? '' : 's'}.`} Keep stress tests, email alerts and more AI questions with Pro.</div>
        <Button size="sm" variant="primary" onClick={() => a.openUpgrade('general')}>Upgrade</Button>
      </div>,
    );
  }
  for (const x of visible.slice(0, 2)) {
    out.push(
      <div className="w-banner" key={`ann-${x.id}`}>
        <Icon name="info" size={16} />
        <div className="w-banner-t"><strong>{x.title}</strong>{x.body ? ` ${x.body}` : ''}{x.link && <> <a href={x.link} target="_blank" rel="noopener noreferrer">Read more</a></>}</div>
        <Button size="sm" variant="ghost" iconOnly icon="close" onClick={() => {
          const next = [...dismissed, x.id];
          setDismissed(next);
          try {
            localStorage.setItem('arzish.ann.dismissed', JSON.stringify(next.slice(-50)));
          } catch {
            /* ignore */
          }
        }}>Dismiss</Button>
      </div>,
    );
  }
  return out.length ? <div className="w-banners">{out}</div> : null;
}

// ------------------------------------------------------------------ locked screens

const LOCK_COPY: Record<string, { title: string; headline: string; points: string[] }> = {
  stress: {
    title: 'Stress tests',
    headline: 'Stress tests are part of Pro',
    points: ['Replay 2008, the 2022 rupee crisis or your own scenario on today’s holdings', 'See the hit in rupees, in dollars and after inflation', 'Describe a scenario in plain words and let AI set the shocks'],
  },
  optimizer: {
    title: 'Optimizer',
    headline: 'The optimizer is part of Pro',
    points: ['Compare your mix with the efficient frontier', 'Target mixes for your risk level, with Shariah and liquidity limits', 'Rebalancing trades to get there'],
  },
  tax: {
    title: 'Tax and zakat',
    headline: 'Tax and zakat are part of Pro',
    points: ['Capital gains, dividend and profit tax for filers and non-filers', 'Zakat on your holdings with gold or silver nisab', 'A yearly zakat reminder before your date'],
  },
};

export function Locked({ view }: { view: View }) {
  const a = useAccount();
  const c = LOCK_COPY[view] ?? { title: 'This screen', headline: 'This screen is part of Pro', points: [] };
  const signedIn = a.status === 'signedIn';
  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title={c.title} />
      <Card>
        <div className="w-paywall">
          <div className="w-paywall-icon"><Icon name="lock" size={22} /></div>
          <h2>{c.headline}</h2>
          <ul>
            {c.points.map((p) => <li key={p}><Icon name="check" size={14} /> {p}</li>)}
          </ul>
          {signedIn ? (
            <Button variant="primary" icon="bolt" onClick={() => a.openUpgrade('pro_screens')}>See Pro</Button>
          ) : (
            <>
              <Button variant="primary" icon="user" onClick={a.goSignIn}>Sign in to start a free {String(a.settings.trial_days ?? 14)}-day Pro trial</Button>
              <div className="tiny muted">No card needed for the trial.</div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ performance

interface Snap {
  d: string;
  value_pkr: number;
}

export function PerformanceCard() {
  const a = useAccount();
  const { active } = useWS();
  const fmt = useFmt();
  const colors = useColors();
  const [snaps, setSnaps] = useState<Snap[] | null>(null);
  const pro = !!a.plan.limits.pro_screens;

  useEffect(() => {
    if (a.status !== 'signedIn' || active.isExample || !pro) return;
    setSnaps(null);
    const since = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
    sb.from('portfolio_snapshots').select('d, value_pkr').eq('portfolio_id', active.id).gte('d', since).order('d').then(({ data }) => setSnaps((data ?? []).map((r: { d: string; value_pkr: number | string }) => ({ d: r.d, value_pkr: Number(r.value_pkr) }))));
  }, [a.status, active.id, active.isExample, pro]);

  const stats = useMemo(() => {
    if (!snaps || snaps.length < 2) return null;
    const last = snaps[snaps.length - 1];
    const at = (days: number) => {
      const cut = new Date(Date.parse(last.d) - days * 864e5).toISOString().slice(0, 10);
      return [...snaps].reverse().find((s) => s.d <= cut);
    };
    const ch = (s?: Snap) => (s && s.value_pkr > 0 ? (last.value_pkr / s.value_pkr - 1) * 100 : null);
    const ytdBase = [...snaps].reverse().find((s) => s.d < `${last.d.slice(0, 4)}-01-01`) ?? snaps[0];
    return { w: ch(at(7)), m: ch(at(30)), ytd: ch(ytdBase), first: snaps[0] };
  }, [snaps]);

  if (a.status !== 'signedIn' || active.isExample) return null;
  if (!pro) {
    return (
      <div className="w-teaser">
        <Icon name="trend" size={16} />
        <span>Arzish records your portfolio’s value every evening. Pro shows how it has moved day by day.</span>
        <button type="button" className="linkbtn small" onClick={() => a.openUpgrade('performance')}>See Pro</button>
      </div>
    );
  }
  const pct = (v: number | null) => (v === null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
  return (
    <Card title="Performance" sub={snaps && snaps.length ? `Value of your holdings at each evening’s prices, since ${fmtDate(snaps[0].d)}` : 'Value of your holdings at each evening’s prices'}>
      {snaps === null ? (
        <div className="row small muted"><Spinner /> Loading…</div>
      ) : snaps.length < 2 ? (
        <p className="small ink2">Arzish records this portfolio’s value every evening after the market data loads. The chart starts once there are two days to compare.</p>
      ) : (
        <div className="stack">
          <div className="row" style={{ gap: 18 }}>
            <span className="small">1 week <strong className={stats?.w !== null && (stats?.w ?? 0) < 0 ? 'down' : 'up'}>{pct(stats?.w ?? null)}</strong></span>
            <span className="small">1 month <strong className={stats?.m !== null && (stats?.m ?? 0) < 0 ? 'down' : 'up'}>{pct(stats?.m ?? null)}</strong></span>
            <span className="small">This year <strong className={stats?.ytd !== null && (stats?.ytd ?? 0) < 0 ? 'down' : 'up'}>{pct(stats?.ytd ?? null)}</strong></span>
            <span className="tiny muted">Changes include money you added or took out.</span>
          </div>
          <MultiLineChart
            labels={snaps.map((s) => fmtDate(s.d))}
            series={[{ name: active.name, data: snaps.map((s) => fmt.conv(s.value_pkr)), color: colors.accent }]}
            fmtVal={fmt.baseC}
            fmtAxis={fmt.axis}
            height={220}
            endLabels={false}
            ariaLabel={`Value of ${active.name} by day`}
          />
        </div>
      )}
    </Card>
  );
}
