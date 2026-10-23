// Account state for the web edition: who is signed in, their profile, plan and AI usage, the public
// settings and plans, and the dialogs (account, upgrade) other parts of the app open.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { sb, api } from './supabase';
import type { Entitlements, Feature, LimitName, UpgradeReason } from '../state/entitlements';
import type { View } from '../state/store';

export interface PlanInfo {
  plan: string;
  name: string;
  status: 'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
  source?: string;
  interval?: string;
  periodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  limits: Record<string, number | boolean>;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'user' | 'admin';
  referral_code: string;
  marketing_opt_in: boolean;
  created_at: string;
}

export interface PlanRow {
  id: string;
  name: string;
  price_pkr_month: number | null;
  price_pkr_year: number | null;
  price_usd_month: number | null;
  price_usd_year: number | null;
  limits: Record<string, number | boolean>;
  features: string[];
  public: boolean;
  sort: number;
  safepay_plan_month?: string | null;
  safepay_plan_year?: string | null;
}

export type AccountTab = 'plan' | 'notifications' | 'alerts' | 'profile' | 'invite' | 'help';

export interface Account {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: Session | null;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  plan: PlanInfo;
  aiUsed: number;
  settings: Record<string, unknown>;
  plans: PlanRow[];
  isAdmin: boolean;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
  openAccount(tab?: AccountTab): void;
  openUpgrade(reason?: UpgradeReason): void;
  goSignIn(): void;
  dialog: { kind: 'account'; tab: AccountTab } | { kind: 'upgrade'; reason: UpgradeReason } | null;
  closeDialog(): void;
}

export const FREE_LIMITS: Record<string, number | boolean> = { portfolios: 1, holdings: 25, goals: 2, ai_month: 5, email_alerts: false, pro_screens: false, import: false, alerts: 3 };
const FREE: PlanInfo = { plan: 'free', name: 'Free', status: 'free', limits: FREE_LIMITS };

const AccountContext = createContext<Account | null>(null);

export function useAccount(): Account {
  const a = useContext(AccountContext);
  if (!a) throw new Error('AccountContext missing');
  return a;
}

export function signInUrl(next = '/app'): string {
  return `/signin?next=${encodeURIComponent(next)}`;
}

export function AccountProvider({ initial, children }: { initial: Session | null; children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(initial);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [plan, setPlan] = useState<PlanInfo>(FREE);
  const [aiUsed, setAiUsed] = useState(0);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dialog, setDialog] = useState<Account['dialog']>(null);
  const userId = session?.user?.id ?? null;

  const refresh = useCallback(async () => {
    const pub = Promise.all([
      sb.from('app_settings').select('key, value'),
      sb.from('plans').select('*').order('sort'),
    ]);
    if (userId) {
      const [prof, p, used] = await Promise.all([
        sb.from('profiles').select('id, email, full_name, role, referral_code, marketing_opt_in, created_at').eq('id', userId).maybeSingle(),
        sb.rpc('my_plan'),
        sb.rpc('my_ai_used'),
      ]);
      if (prof.data) setProfile(prof.data as Profile);
      if (p.data) setPlan(p.data as PlanInfo);
      if (typeof used.data === 'number') setAiUsed(used.data);
    }
    const [s, pl] = await pub;
    if (s.data) setSettings(Object.fromEntries(s.data.map((r: { key: string; value: unknown }) => [r.key, r.value])));
    if (pl.data) setPlans(pl.data as PlanRow[]);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Seen today (for the back office), and a referral code saved from the landing page.
  useEffect(() => {
    if (!userId) return;
    sb.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId).then(() => undefined);
    let ref: string | null = null;
    try {
      ref = localStorage.getItem('arzish.ref');
    } catch {
      ref = null;
    }
    if (ref) {
      api('account/referral', { code: ref }).catch(() => undefined).finally(() => {
        try {
          localStorage.removeItem('arzish.ref');
        } catch {
          /* ignore */
        }
      });
    }
  }, [userId]);

  // Live AI usage from the AI route's response headers.
  useEffect(() => {
    const onUsage = (e: Event) => {
      const d = (e as CustomEvent).detail as { used: number };
      if (typeof d?.used === 'number') setAiUsed(d.used);
    };
    const onUpgrade = (e: Event) => {
      const r = ((e as CustomEvent).detail?.reason ?? 'general') as UpgradeReason;
      setDialog({ kind: 'upgrade', reason: r });
    };
    window.addEventListener('arzish:ai-usage', onUsage);
    window.addEventListener('arzish:upgrade', onUpgrade);
    return () => {
      window.removeEventListener('arzish:ai-usage', onUsage);
      window.removeEventListener('arzish:upgrade', onUpgrade);
    };
  }, []);

  const signOut = useCallback(async () => {
    await sb.auth.signOut().catch(() => undefined);
    window.location.assign('/');
  }, []);

  const value = useMemo<Account>(() => ({
    status: !loaded && userId ? 'loading' : userId ? 'signedIn' : 'signedOut',
    session,
    userId,
    email: session?.user?.email ?? null,
    profile,
    plan: userId ? plan : FREE,
    aiUsed,
    settings,
    plans,
    isAdmin: profile?.role === 'admin',
    refresh,
    signOut,
    openAccount: (tab: AccountTab = 'plan') => setDialog(userId ? { kind: 'account', tab } : null),
    openUpgrade: (reason: UpgradeReason = 'general') => setDialog({ kind: 'upgrade', reason }),
    goSignIn: () => window.location.assign(signInUrl(window.location.pathname + window.location.hash)),
    dialog,
    closeDialog: () => setDialog(null),
  }), [loaded, userId, session, profile, plan, aiUsed, settings, plans, refresh, signOut, dialog]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

/** The entitlements the shared app reads, from the account's plan. */
export function useWebEntitlements(locked: (v: View) => React.ReactNode): Entitlements {
  const a = useAccount();
  return useMemo<Entitlements>(() => {
    const L = a.plan.limits ?? FREE_LIMITS;
    const num = (k: string, fb: number) => (typeof L[k] === 'number' ? (L[k] as number) : fb);
    return {
      web: true,
      signedIn: a.status === 'signedIn',
      plan: a.plan.plan,
      planName: a.plan.name,
      can: (f: Feature) => {
        if (f === 'performance') return !!L.pro_screens;
        return !!L[f];
      },
      limit: (l: LimitName) => num(l, Infinity),
      upgrade: (reason: UpgradeReason) => a.openUpgrade(reason),
      signIn: () => a.goSignIn(),
      ai: a.status === 'signedIn' ? { used: a.aiUsed, limit: num('ai_month', 0) } : undefined,
      locked,
    };
  }, [a, locked]);
}

/** Days left until an ISO date (rounded up), or null. */
export function daysLeft(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  return isFinite(ms) ? Math.max(0, Math.ceil(ms / 864e5)) : null;
}

export const fmtPkr = (v: number | null | undefined): string => (v === null || v === undefined ? '–' : `Rs ${Math.round(v).toLocaleString('en-US')}`);
