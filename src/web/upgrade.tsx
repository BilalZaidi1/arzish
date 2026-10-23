// The upgrade dialog: why a feature needs Pro, the plans side by side, card checkout through Safepay,
// or a request for Pro while card payments are not open, and gift codes.
import React, { useState } from 'react';
import { api, errorText } from './supabase';
import { fmtPkr, useAccount, type PlanRow } from './session';
import type { UpgradeReason } from '../state/entitlements';
import { Icon } from '../ui/components/Icon';
import { Button, Callout, Modal, Seg } from '../ui/components/primitives';

const REASONS: Record<string, { title: string; body: string }> = {
  pro_screens: { title: 'Stress tests, the optimizer and tax and zakat are in Pro', body: 'See how a crash, a rupee slide or a rate rise would hit your holdings, get a target mix for your risk level, and work out tax and zakat in one place.' },
  holdings: { title: 'The Free plan covers 25 holdings', body: 'Pro has room for your whole family’s portfolio: shares, funds, savings certificates, gold, property and foreign accounts.' },
  portfolios: { title: 'The Free plan covers one portfolio', body: 'Pro lets you keep separate portfolios, for example yours, your spouse’s and a child’s education fund.' },
  goals: { title: 'The Free plan covers two goals', body: 'Pro lets you plan every goal: retirement, school fees, Hajj, a home and more, each with its own odds.' },
  alerts: { title: 'Price and drawdown alerts are in Pro', body: 'Get told when a share moves sharply, reaches your target price, or a portfolio falls from its peak.' },
  ai: { title: 'You have used this month’s AI questions', body: 'Pro includes many more questions to the AI analyst each month, plus reading statements from screenshots.' },
  import: { title: 'Reading statements from screenshots is in Pro', body: 'Snap your broker, CDC or fund statement and the AI turns it into holdings for you to check and add.' },
  email_alerts: { title: 'Email alerts are in Pro', body: 'On Free, alerts appear in the app. Pro also emails them, so you never miss a maturity or a rate change.' },
  performance: { title: 'Performance tracking is in Pro', body: 'See how your portfolio’s value has moved day by day, week by week and this year.' },
  general: { title: 'Upgrade to Pro', body: 'Everything in Arzish, with more AI questions and alerts by email.' },
};

function PlanCard({ p, current, interval, children }: { p: PlanRow; current: boolean; interval: 'month' | 'year'; children?: React.ReactNode }) {
  const price = interval === 'year' ? p.price_pkr_year : p.price_pkr_month;
  const monthly = interval === 'year' && p.price_pkr_year ? p.price_pkr_year / 12 : null;
  const saving = interval === 'year' && p.price_pkr_month && p.price_pkr_year ? p.price_pkr_month * 12 - p.price_pkr_year : 0;
  return (
    <div className={'w-plan-card' + (p.id === 'pro' ? ' featured' : '')}>
      <div className="row-between">
        <div className="w-plan-name">{p.name}</div>
        {current && <span className="badge accent">Your plan</span>}
      </div>
      <div className="w-plan-price">
        {price ? <>{fmtPkr(price)}<span className="small muted"> / {interval}</span></> : <>Free</>}
      </div>
      <div className="tiny muted" style={{ minHeight: 16 }}>
        {monthly ? `${fmtPkr(monthly)} a month, billed yearly${saving > 0 ? ` · save ${fmtPkr(saving)}` : ''}` : p.price_usd_month ? `about $${p.price_usd_month} a month` : ''}
      </div>
      <ul className="w-plan-feats">
        {(p.features ?? []).map((f) => <li key={f}><Icon name="check" size={14} /> {f}</li>)}
      </ul>
      {children}
    </div>
  );
}

export function UpgradeModal({ reason, onClose }: { reason: UpgradeReason; onClose: () => void }) {
  const a = useAccount();
  const [interval, setBilling] = useState<'month' | 'year'>('year');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null);
  const [code, setCode] = useState('');
  const r = REASONS[reason] ?? REASONS.general;
  const free = a.plans.find((p) => p.id === 'free');
  const pro = a.plans.find((p) => p.id === 'pro');
  const payments = a.settings.payments_enabled === true;
  const signedIn = a.status === 'signedIn';
  const onPro = a.plan.plan !== 'free' && a.plan.status !== 'trialing';

  const checkout = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await api<{ url: string }>('billing/checkout', { plan: 'pro', interval });
      window.location.assign(out.url);
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
      setBusy(false);
    }
  };
  const request = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api('feedback', { kind: 'billing', message: `Please upgrade me to Pro, billed ${interval}ly.`, page: 'upgrade' });
      setMsg({ tone: 'good', text: 'Request sent. We will reply by email with how to pay by bank transfer or wallet, and switch Pro on.' });
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
    }
    setBusy(false);
  };
  const redeem = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const out = await api<{ until: string; days: number }>('billing/redeem', { code });
      await a.refresh();
      setMsg({ tone: 'good', text: `Code applied: ${out.days} days of Pro added.` });
      setCode('');
    } catch (e) {
      setMsg({ tone: 'warn', text: errorText(e) });
    }
    setBusy(false);
  };

  return (
    <Modal wide title={r.title} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <p className="ink2" style={{ margin: 0 }}>{r.body}</p>
        <div className="row-between">
          <Seg label="Billing period" value={interval} onChange={setBilling} options={[{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }]} />
          {a.plan.status === 'trialing' && <span className="small muted">Your trial keeps Pro on until it ends.</span>}
        </div>
        <div className="w-plan-grid">
          {free && <PlanCard p={free} current={a.plan.plan === 'free' && signedIn} interval={interval} />}
          {pro && (
            <PlanCard p={pro} current={onPro} interval={interval}>
              {!signedIn ? (
                <Button variant="primary" onClick={a.goSignIn}>Sign in to start a free trial</Button>
              ) : onPro ? (
                <Button disabled>You are on Pro</Button>
              ) : payments ? (
                <Button variant="primary" icon="card" disabled={busy} onClick={checkout}>{busy ? 'Opening checkout…' : `Pay ${fmtPkr(interval === 'year' ? pro.price_pkr_year : pro.price_pkr_month)} by card`}</Button>
              ) : (
                <>
                  <Button variant="primary" disabled={busy} onClick={request}>Ask for Pro</Button>
                  <div className="tiny muted">Card payments open soon. Until then we switch Pro on after a bank transfer or wallet payment.</div>
                </>
              )}
            </PlanCard>
          )}
        </div>
        {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
        {signedIn && (
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '1 1 220px', maxWidth: 320 }}>
              <label htmlFor="w-code">Have a code?</label>
              <input id="w-code" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" autoComplete="off" />
            </div>
            <Button disabled={busy || !code.trim()} onClick={redeem}>Apply</Button>
          </div>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>Prices in Pakistani rupees. Cancel any time from Plan and billing; you keep Pro until the end of the period you paid for. Arzish shows estimates for education and planning, not investment advice.</p>
      </div>
    </Modal>
  );
}
