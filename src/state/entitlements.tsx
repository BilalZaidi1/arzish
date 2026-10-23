// What the current person may use. The artifact edition has no plans, so everything is allowed;
// the hosted web edition provides the real values (src/web/session.tsx).
import React, { createContext, useContext } from 'react';
import type { View } from './store';

export type Feature = 'pro_screens' | 'import' | 'email_alerts' | 'performance';
export type LimitName = 'portfolios' | 'holdings' | 'goals' | 'alerts';
export type UpgradeReason = Feature | LimitName | 'ai' | 'general';

export interface Entitlements {
  /** True in the hosted web edition. */
  web: boolean;
  signedIn: boolean;
  plan: string;
  planName: string;
  can(f: Feature): boolean;
  limit(l: LimitName): number;
  /** Show the upgrade dialog, explaining what needs a paid plan. */
  upgrade(reason: UpgradeReason): void;
  /** Ask a signed-out visitor to sign in. */
  signIn(): void;
  /** AI questions used and allowed this month, when known. */
  ai?: { used: number; limit: number };
  /** The screen shown in place of a paid-only view. */
  locked?(view: View): React.ReactNode;
}

const OPEN: Entitlements = {
  web: false,
  signedIn: true,
  plan: 'pro',
  planName: 'Pro',
  can: () => true,
  limit: () => Infinity,
  upgrade: () => undefined,
  signIn: () => undefined,
};

export const EntitlementsContext = createContext<Entitlements>(OPEN);

export function useEntitlements(): Entitlements {
  return useContext(EntitlementsContext);
}

/** Screens that need a paid plan. */
export const PRO_VIEWS: View[] = ['stress', 'optimizer', 'tax'];

/** Holdings in the person's own portfolios (examples do not count). */
export function ownCounts(portfolios: { isExample?: boolean; holdings: unknown[]; goals: unknown[] }[]): { portfolios: number; holdings: number; goals: number } {
  const own = portfolios.filter((p) => !p.isExample);
  return {
    portfolios: own.length,
    holdings: own.reduce((s, p) => s + p.holdings.length, 0),
    goals: own.reduce((s, p) => s + p.goals.length, 0),
  };
}
