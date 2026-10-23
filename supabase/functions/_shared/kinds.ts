// Notification types, their default channels and which plan they need. The web app's settings
// screen uses the same list (src/web/kinds.ts is a copy).

export interface KindMeta {
  label: string;
  desc: string;
  inapp: boolean;
  email: boolean;
  /** Needs a paid plan (Pro or above). */
  pro?: boolean;
  /** Always sent; cannot be switched off. */
  locked?: boolean;
}

export const NOTIFICATION_KINDS: Record<string, KindMeta> = {
  maturity: { label: 'Maturity reminders', desc: '30 and 7 days before a certificate, T-bill, PIB or deposit matures', inapp: true, email: true },
  policy_rate: { label: 'Policy rate changes', desc: 'When SBP changes the policy rate', inapp: true, email: true },
  nss_rate: { label: 'National Savings rate changes', desc: 'When CDNS changes the rate of a scheme you hold', inapp: true, email: true },
  ex_dividend: { label: 'Ex-dividend', desc: 'When a PSX share you hold starts trading ex-dividend', inapp: true, email: false },
  fund_stale: { label: 'Fund stopped reporting', desc: 'When a linked fund has had no new NAV for about a week', inapp: true, email: false },
  price_alert: { label: 'Price alerts', desc: 'Your price-move and target-price alerts', inapp: true, email: true },
  drawdown: { label: 'Drawdown alerts', desc: 'When a portfolio falls a set share from its peak', inapp: true, email: true },
  zakat: { label: 'Zakat reminder', desc: 'A week before your zakat date', inapp: true, email: true, pro: true },
  tax: { label: 'Tax reminders', desc: 'VPS contributions before 30 June; tax return by 30 September', inapp: true, email: true, pro: true },
  announcement: { label: 'Announcements', desc: 'News about Arzish', inapp: true, email: false },
  billing: { label: 'Billing and trial', desc: 'Payments, renewals and trial reminders', inapp: true, email: true, locked: true },
  feedback_reply: { label: 'Replies to your feedback', desc: 'When we answer something you sent', inapp: true, email: true, locked: true },
};

export type Prefs = Record<string, { inapp?: boolean; email?: boolean }>;

export function wants(prefs: Prefs | null | undefined, kind: string, channel: 'inapp' | 'email'): boolean {
  const meta = NOTIFICATION_KINDS[kind];
  if (!meta) return channel === 'inapp';
  if (meta.locked) return true;
  const v = prefs?.[kind]?.[channel];
  return typeof v === 'boolean' ? v : meta[channel];
}
