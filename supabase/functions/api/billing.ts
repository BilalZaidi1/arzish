// Billing: Safepay subscription checkout, cancellation, coupons and the Safepay webhook.
// Safepay keys live in function secrets (SAFEPAY_SECRET_KEY, SAFEPAY_WEBHOOK_SECRET), never in the database.
import { addNotification, admin, audit, fail, getUser, json, readJson, setting } from '../_shared/shared.ts';
import { appUrl, layout, sendEmail, table } from '../_shared/email.ts';

type Json = Record<string, any>;

const API = { production: 'https://api.getsafepay.com', sandbox: 'https://sandbox.api.getsafepay.com' };
const CHECKOUT = { production: 'https://getsafepay.com/checkout', sandbox: 'https://sandbox.api.getsafepay.com/checkout' };

async function env(): Promise<'production' | 'sandbox'> {
  return (await setting<string>('safepay_env', 'sandbox')) === 'production' ? 'production' : 'sandbox';
}

function randomToken(bytes = 16): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function safepay(path: string, method = 'POST', body: Json = {}): Promise<Json> {
  const secret = Deno.env.get('SAFEPAY_SECRET_KEY');
  if (!secret) throw new Error('payments_unavailable');
  const r = await fetch(`${API[await env()]}/client${path}`, {
    method,
    headers: { 'X-SFPY-MERCHANT-SECRET': secret, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`safepay ${r.status}: ${JSON.stringify(out).slice(0, 200)}`);
  return out;
}

// ------------------------------------------------------------------ checkout
export async function checkout(req: Request): Promise<Response> {
  const user = await getUser(req);
  if (!user) return fail(401, 'signin_required', 'Sign in first.');
  if (!(await setting<boolean>('payments_enabled', false)) || !Deno.env.get('SAFEPAY_SECRET_KEY')) {
    return fail(503, 'payments_unavailable', 'Card payments are not open yet.');
  }
  const body = await readJson<{ plan?: string; interval?: string }>(req);
  const interval = body.interval === 'year' ? 'year' : 'month';
  const { data: plan } = await admin.from('plans').select('*').eq('id', String(body.plan ?? 'pro')).maybeSingle();
  if (!plan || !plan.public || plan.id === 'free') return fail(400, 'bad_plan', 'That plan is not available.');
  const spPlan = interval === 'year' ? plan.safepay_plan_year : plan.safepay_plan_month;
  if (!spPlan) return fail(503, 'payments_unavailable', `The ${interval}ly ${plan.name} plan is not set up for card payments yet.`);
  const base = await appUrl('/app');
  if (!base.startsWith('http')) return fail(503, 'payments_unavailable', 'The app address is not set yet.');

  const token = randomToken();
  const { error } = await admin.from('checkout_sessions').insert({ token, user_id: user.id, plan_id: plan.id, interval });
  if (error) return fail(500, 'checkout_failed', 'Could not start checkout. Try again.');
  let auth: Json;
  try {
    auth = await safepay('/passport/v1/token');
  } catch (e) {
    return fail(502, 'checkout_failed', 'The payment service did not respond. Try again shortly.', { detail: (e as Error).message.slice(0, 200) });
  }
  const authToken = typeof auth.data === 'string' ? auth.data : auth.data?.token;
  if (!authToken) return fail(502, 'checkout_failed', 'The payment service did not respond. Try again shortly.');
  const e = await env();
  const params = new URLSearchParams({
    plan_id: spPlan,
    auth_token: authToken,
    env: e,
    cancel_url: `${base}?billing=cancelled`,
    redirect_url: `${base}?billing=success&ref=${token}`,
    reference: token,
  });
  return json({ url: `${CHECKOUT[e]}/subscribe?${params.toString()}`, ref: token });
}

// ------------------------------------------------------------------ cancel
export async function cancel(req: Request): Promise<Response> {
  const user = await getUser(req);
  if (!user) return fail(401, 'signin_required', 'Sign in first.');
  const { data: subs } = await admin.from('subscriptions').select('*').eq('user_id', user.id).eq('source', 'safepay').in('status', ['active', 'past_due', 'trialing']).order('created_at', { ascending: false }).limit(1);
  const sub = subs?.[0];
  if (!sub) return fail(404, 'no_subscription', 'There is no card subscription to cancel.');
  if (sub.provider_ref) {
    try {
      await safepay(`/subscriptions/v1/${encodeURIComponent(sub.provider_ref)}/cancel`);
    } catch (e) {
      return fail(502, 'cancel_failed', 'The payment service did not confirm the cancellation. Try again, or contact support.', { detail: (e as Error).message.slice(0, 200) });
    }
  }
  await admin.from('subscriptions').update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq('id', sub.id);
  await audit(user.id, 'billing.cancel', 'subscription', String(sub.id), { status: sub.status }, { cancel_at_period_end: true });
  const end = sub.current_period_end ? String(sub.current_period_end).slice(0, 10) : null;
  await addNotification(user.id, { kind: 'billing', title: 'Your plan will not renew', body: end ? `You keep Pro until ${end}. After that you move to Free; your data stays.` : 'You move to Free at the end of the period; your data stays.', link: '#billing' });
  return json({ ok: true, until: sub.current_period_end });
}

// ------------------------------------------------------------------ coupons
export async function redeem(req: Request): Promise<Response> {
  const user = await getUser(req);
  if (!user) return fail(401, 'signin_required', 'Sign in first.');
  const body = await readJson<{ code?: string }>(req);
  const code = String(body.code ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code) return fail(400, 'bad_code', 'Enter a code.');
  const { data: c } = await admin.from('coupons').select('*').eq('code', code).maybeSingle();
  if (!c || !c.active || (c.expires_at && Date.parse(c.expires_at) < Date.now()) || (c.max_redemptions && c.redeemed >= c.max_redemptions)) {
    return fail(400, 'invalid_code', 'That code is not valid or has expired.');
  }
  const { error: dup } = await admin.from('coupon_redemptions').insert({ user_id: user.id, code });
  if (dup) return fail(400, 'already_used', 'You have already used this code.');
  await admin.from('coupons').update({ redeemed: c.redeemed + 1 }).eq('code', code);
  // Extend from the end of any live Pro period so time is never lost.
  const { data: live } = await admin.from('subscriptions').select('current_period_end').eq('user_id', user.id).eq('plan_id', 'pro').in('status', ['trialing', 'active']).order('current_period_end', { ascending: false }).limit(1);
  const from = Math.max(Date.now(), live?.[0]?.current_period_end ? Date.parse(live[0].current_period_end) : 0);
  const end = new Date(from + c.value * 864e5).toISOString();
  const { data: sub } = await admin.from('subscriptions').insert({ user_id: user.id, plan_id: 'pro', status: 'active', source: 'coupon', current_period_start: new Date().toISOString(), current_period_end: end, note: `Code ${code}` }).select('id').single();
  await audit(user.id, 'billing.redeem', 'coupon', code, null, { days: c.value, subscription: sub?.id });
  await addNotification(user.id, { kind: 'billing', title: `Code applied: Pro until ${end.slice(0, 10)}`, body: `${c.value} days of Pro were added to your account.`, link: '#billing' });
  return json({ ok: true, until: end, days: c.value });
}

// ------------------------------------------------------------------ webhook
async function hmacHex(algo: 'SHA-512' | 'SHA-256', secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: algo }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const STATUS: Record<string, string> = {
  ACTIVE: 'active', TRAILING: 'trialing', TRIALING: 'trialing', PAST_DUE: 'past_due', UNPAID: 'past_due', INCOMPLETE: 'past_due',
  CANCELED: 'canceled', CANCELLED: 'canceled', ENDED: 'canceled', INCOMPLETE_EXPIRED: 'canceled', PAUSED: 'canceled',
};

function dateOf(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'object' && v && 'seconds' in (v as Json)) return new Date(Number((v as Json).seconds) * 1000).toISOString();
  const t = Date.parse(String(v));
  return isFinite(t) ? new Date(t).toISOString() : null;
}

/** Find the subscription object in a Safepay event, whatever its nesting. */
function findSubscription(d: Json): Json | null {
  if (!d || typeof d !== 'object') return null;
  if (d.subscription && typeof d.subscription === 'object') return d.subscription;
  if (typeof d.plan_id === 'string' && typeof d.status === 'string') return d;
  for (const v of Object.values(d)) {
    if (v && typeof v === 'object' && typeof (v as Json).plan_id === 'string' && typeof (v as Json).status === 'string') return v as Json;
  }
  return null;
}

export async function webhook(req: Request): Promise<Response> {
  const secret = Deno.env.get('SAFEPAY_WEBHOOK_SECRET');
  const raw = await req.text();
  let body: Json;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'bad_request');
  }
  const data = (body.data ?? body.notification ?? {}) as Json;
  const type = String(body.type ?? body.event ?? data.type ?? 'unknown');
  const sigHeader = (req.headers.get('x-sfpy-signature') ?? '').toLowerCase();
  const ok = !!secret && !!sigHeader && sigHeader === (await hmacHex('SHA-512', secret, JSON.stringify(body.data)));
  const { data: ev } = await admin.from('billing_events').insert({ provider: 'safepay', type, data: body, signature_ok: ok }).select('id').single();
  if (!ok) return fail(401, 'bad_signature');

  try {
    const result = await processEvent(type, data);
    await admin.from('billing_events').update({ processed: true, result }).eq('id', ev?.id);
    return json({ ok: true });
  } catch (e) {
    await admin.from('billing_events').update({ processed: false, error: (e as Error).message.slice(0, 500) }).eq('id', ev?.id);
    // 200 so Safepay does not retry forever; the admin sees the error in the back office.
    return json({ ok: false });
  }
}

async function processEvent(type: string, data: Json): Promise<Json> {
  const sp = findSubscription(data);
  const reference = String(sp?.reference ?? data.reference ?? data.metadata?.reference ?? '');
  const spToken = String(sp?.token ?? data.subscription_id ?? '');
  let session: Json | null = null;
  if (reference) session = (await admin.from('checkout_sessions').select('*').eq('token', reference).maybeSingle()).data;
  let ours: Json | null = null;
  if (spToken) ours = (await admin.from('subscriptions').select('*').eq('provider_ref', spToken).order('created_at', { ascending: false }).limit(1)).data?.[0] ?? null;
  const userId: string | null = session?.user_id ?? ours?.user_id ?? null;
  if (!userId) return { skipped: 'no matching checkout or subscription', reference, spToken };

  // Plan: from the checkout, else by Safepay plan id.
  let planId: string = session?.plan_id ?? ours?.plan_id ?? 'pro';
  let interval: string = session?.interval ?? ours?.interval ?? 'month';
  const spPlan = String(sp?.plan_id ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!session && spPlan) {
    const { data: pl } = await admin.from('plans').select('id, safepay_plan_month, safepay_plan_year').or(`safepay_plan_month.eq.${spPlan},safepay_plan_year.eq.${spPlan}`).limit(1);
    if (pl?.[0]) {
      planId = pl[0].id;
      interval = pl[0].safepay_plan_year === spPlan ? 'year' : 'month';
    }
  }
  const now = new Date().toISOString();
  const out: Json = { userId, planId };

  if (sp) {
    let status = STATUS[String(sp.status ?? '').toUpperCase()] ?? (/paid|succeed|success|renew|activ/i.test(type) ? 'active' : null);
    const periodEnd = dateOf(sp.current_period_end_date) ?? (ours?.current_period_end ?? null);
    // A cancellation the user asked for keeps the paid time.
    if (status === 'canceled' && ours?.cancel_at_period_end && periodEnd && Date.parse(periodEnd) > Date.now()) status = 'active';
    if (status) {
      const row = {
        user_id: userId, plan_id: planId, interval, status, source: 'safepay', provider_ref: spToken || null,
        current_period_start: dateOf(sp.current_period_start_date) ?? ours?.current_period_start ?? now,
        current_period_end: periodEnd ?? new Date(Date.now() + (interval === 'year' ? 366 : 31) * 864e5).toISOString(),
        cancel_at_period_end: !!(sp.cancel_at_period_end ?? ours?.cancel_at_period_end),
        updated_at: now,
      };
      if (ours) await admin.from('subscriptions').update(row).eq('id', ours.id);
      else ours = (await admin.from('subscriptions').insert({ ...row, note: 'Card subscription' }).select('*').single()).data;
      out.status = status;
    }
    if (session && !session.completed_at) await admin.from('checkout_sessions').update({ completed_at: now, subscription_ref: spToken || null }).eq('token', session.token);
  }

  // A successful charge: record the payment once.
  const paidState = String(data.state ?? data.payment?.state ?? data.tracker?.state ?? '').toUpperCase();
  const isPaid = /paid|succeed|success|renew|charge/i.test(type) || ['PAID', 'TRACKER_ENDED', 'SUCCEEDED'].includes(paidState) || (sp && String(sp.status).toUpperCase() === 'ACTIVE' && /creat|activ/i.test(type));
  if (isPaid) {
    const ref = String(data.payment?.token ?? data.tracker?.token ?? data.tracker ?? (sp ? `${spToken}:${sp.current_period_start_date ?? now.slice(0, 10)}` : data.token ?? ''));
    const amount = Number(data.amount ?? data.payment?.amount ?? sp?.price_amount ?? sp?.plan?.amount ?? 0) || null;
    const currency = String(data.currency ?? data.payment?.currency ?? sp?.price_currency ?? sp?.plan?.currency ?? 'PKR');
    const { error: dupe, data: pay } = await admin.from('payments').insert({ user_id: userId, subscription_id: ours?.id ?? null, plan_id: planId, interval, amount, currency, provider: 'safepay', provider_ref: ref || null, status: 'paid', raw: data }).select('id').single();
    if (!dupe && pay) {
      out.payment = pay.id;
      await afterPayment(userId, planId, interval, amount, currency, ours);
    }
  }
  return out;
}

async function afterPayment(userId: string, planId: string, interval: string, amount: number | null, currency: string, sub: Json | null) {
  const { data: plan } = await admin.from('plans').select('name').eq('id', planId).maybeSingle();
  const { data: prof } = await admin.from('profiles').select('email, referred_by').eq('id', userId).maybeSingle();
  const { count } = await admin.from('payments').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'paid');
  const first = (count ?? 0) <= 1;
  const until = sub?.current_period_end ? String(sub.current_period_end).slice(0, 10) : '';
  const name = plan?.name ?? 'Pro';
  await addNotification(userId, { kind: 'billing', title: first ? `Welcome to ${name}` : `Payment received for ${name}`, body: until ? `Your plan runs until ${until} and renews automatically.` : 'Thank you. Your plan is active.', link: '#billing' });
  if (prof?.email) {
    const amountText = amount ? `${currency} ${amount.toLocaleString('en-US')}` : '';
    const html = layout({
      title: first ? `Welcome to Arzish ${name}` : `Payment received`,
      preheader: `${name} ${interval}ly${amountText ? `, ${amountText}` : ''}`,
      intro: first ? 'Thank you for subscribing. Everything in your plan is unlocked now.' : 'Thank you. Your plan has renewed.',
      body: table([['Plan', `${name}, billed ${interval}ly`], ...(amountText ? [['Amount', amountText] as [string, string]] : []), ...(until ? [['Paid until', until] as [string, string]] : [])]),
      cta: (await appUrl('/app')).startsWith('http') ? { label: 'Open Arzish', url: await appUrl('/app') } : undefined,
      note: 'Card payments are processed by Safepay. Manage or cancel your plan from Account in the app.',
    });
    await sendEmail({ to: prof.email, subject: first ? `Welcome to Arzish ${name}` : `Arzish payment received`, html, text: `${name}, billed ${interval}ly. ${amountText} ${until ? `Paid until ${until}.` : ''}`, kind: 'billing', userId });
  }
  // Referral reward: the referrer gets Pro days when someone they referred pays for the first time.
  if (first && prof?.referred_by) {
    const days = Number(await setting('referral_reward_days', 30)) || 0;
    if (days > 0) {
      const { data: live } = await admin.from('subscriptions').select('current_period_end').eq('user_id', prof.referred_by).eq('plan_id', 'pro').in('status', ['trialing', 'active']).order('current_period_end', { ascending: false }).limit(1);
      const from = Math.max(Date.now(), live?.[0]?.current_period_end ? Date.parse(live[0].current_period_end) : 0);
      const end = new Date(from + days * 864e5).toISOString();
      await admin.from('subscriptions').insert({ user_id: prof.referred_by, plan_id: 'pro', status: 'active', source: 'referral', current_period_start: new Date().toISOString(), current_period_end: end, note: 'Referral reward' });
      await addNotification(prof.referred_by, { kind: 'billing', title: `You earned ${days} days of Pro`, body: `Someone you invited subscribed. Pro now runs until ${end.slice(0, 10)}.`, link: '#billing', dedupe: `ref-${userId}` });
    }
  }
}
