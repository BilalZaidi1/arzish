// Account actions that need the server: deleting an account, claiming a referral, sending feedback,
// and the one-click unsubscribe link in emails.
import { addNotification, admin, audit, fail, getUser, json, readJson, setting } from '../_shared/shared.ts';
import { esc, layout, sendEmail } from '../_shared/email.ts';
import { NOTIFICATION_KINDS } from '../_shared/kinds.ts';

type Json = Record<string, any>;

export async function deleteAccount(req: Request): Promise<Response> {
  const user = await getUser(req);
  if (!user) return fail(401, 'signin_required', 'Sign in first.');
  const body = await readJson<{ confirm?: string }>(req);
  if (String(body.confirm ?? '').trim().toLowerCase() !== user.email) return fail(400, 'confirm_required', 'Type your email address to confirm.');
  // Stop any card subscription first so nobody is charged after leaving.
  const { data: subs } = await admin.from('subscriptions').select('id, provider_ref').eq('user_id', user.id).eq('source', 'safepay').in('status', ['active', 'past_due', 'trialing']);
  const secret = Deno.env.get('SAFEPAY_SECRET_KEY');
  for (const s of subs ?? []) {
    if (!s.provider_ref || !secret) continue;
    const env = (await setting<string>('safepay_env', 'sandbox')) === 'production' ? 'https://api.getsafepay.com' : 'https://sandbox.api.getsafepay.com';
    try {
      await fetch(`${env}/client/subscriptions/v1/${encodeURIComponent(s.provider_ref)}/cancel`, { method: 'POST', headers: { 'X-SFPY-MERCHANT-SECRET': secret, 'Content-Type': 'application/json' }, body: '{}' });
    } catch {
      // recorded below; an admin can cancel by hand
    }
  }
  await audit(user.id, 'account.delete', 'user', user.id, { subscriptions: (subs ?? []).length }, null);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return fail(500, 'delete_failed', 'Could not delete the account. Contact support.');
  return json({ ok: true });
}

export async function claimReferral(req: Request): Promise<Response> {
  const user = await getUser(req);
  if (!user) return fail(401, 'signin_required', 'Sign in first.');
  const body = await readJson<{ code?: string }>(req);
  const code = String(body.code ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!code) return fail(400, 'bad_code');
  const { data: me } = await admin.from('profiles').select('id, referred_by, created_at, referral_code').eq('id', user.id).maybeSingle();
  if (!me || me.referred_by) return json({ ok: false, reason: 'already' });
  if (me.referral_code === code) return json({ ok: false, reason: 'self' });
  if (Date.now() - Date.parse(me.created_at) > 7 * 864e5) return json({ ok: false, reason: 'too_late' });
  const { data: ref } = await admin.from('profiles').select('id').eq('referral_code', code).maybeSingle();
  if (!ref) return json({ ok: false, reason: 'unknown' });
  await admin.from('profiles').update({ referred_by: ref.id }).eq('id', user.id);
  await audit(user.id, 'referral.claim', 'user', ref.id, null, { code });
  return json({ ok: true });
}

export async function feedback(req: Request): Promise<Response> {
  const user = await getUser(req);
  if (!user) return fail(401, 'signin_required', 'Sign in first.');
  const body = await readJson<{ kind?: string; message?: string; page?: string }>(req);
  const kind = ['bug', 'idea', 'question', 'billing'].includes(String(body.kind)) ? String(body.kind) : 'idea';
  const message = String(body.message ?? '').trim().slice(0, 4000);
  if (message.length < 3) return fail(400, 'too_short', 'Write a little more.');
  const { count } = await admin.from('feedback').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', new Date(Date.now() - 864e5).toISOString());
  if ((count ?? 0) >= 10) return fail(429, 'too_many', 'You have sent a lot today. Try again tomorrow.');
  const page = String(body.page ?? '').slice(0, 80);
  const { data: row, error } = await admin.from('feedback').insert({ user_id: user.id, email: user.email, kind, message: page ? `${message}\n\n(from ${page})` : message }).select('id').single();
  if (error) return fail(500, 'save_failed', 'Could not send. Try again.');
  // The public support address if one is set, otherwise the admins (kept private).
  const support = String(await setting('support_email', ''));
  const admins = await setting('admin_emails', []);
  const to = support.includes('@') ? support : Array.isArray(admins) ? (admins.map(String).find((e) => e.includes('@')) ?? '') : '';
  if (to) {
    const html = layout({ title: `New ${kind} from ${user.email}`, body: `<p style="white-space:pre-wrap">${esc(message)}</p>`, note: `Reply from the back office, or reply to this email to write to ${user.email} directly.` });
    await sendEmail({ to, subject: `[Arzish ${kind}] ${message.slice(0, 60)}`, html, text: message, kind: 'feedback-admin', replyTo: user.email });
  }
  return json({ ok: true, id: row.id });
}

// ------------------------------------------------------------------ unsubscribe (link in every email)
function page(title: string, text: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#F2F4F8;color:#0C1322}main{max-width:480px;margin:12vh auto;background:#fff;border:1px solid #E1E5EE;border-radius:12px;padding:28px}b{color:#2443C8;letter-spacing:.04em}p{color:#475069;line-height:1.55}</style></head>
<body><main><b>ARZISH</b><h1 style="font-size:20px">${esc(title)}</h1><p>${esc(text)}</p></main></body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function unsubscribe(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const t = url.searchParams.get('t') ?? '';
  const k = url.searchParams.get('k') ?? 'alerts';
  if (!/^[0-9a-f-]{36}$/i.test(t)) return page('Link not recognised', 'This unsubscribe link is incomplete. You can change email settings in Arzish under Account, Notifications.');
  const { data: row } = await admin.from('notification_prefs').select('user_id, prefs, digest').eq('unsubscribe_token', t).maybeSingle();
  if (!row) return page('Link not recognised', 'This unsubscribe link has expired. You can change email settings in Arzish under Account, Notifications.');
  const prefs: Json = { ...(row.prefs ?? {}) };
  let what = '';
  if (k === 'digest') {
    await admin.from('notification_prefs').update({ digest: 'off', updated_at: new Date().toISOString() }).eq('user_id', row.user_id);
    what = 'the weekly digest';
  } else {
    const kinds = k === 'alerts' ? Object.keys(NOTIFICATION_KINDS).filter((x) => !NOTIFICATION_KINDS[x].locked) : NOTIFICATION_KINDS[k] && !NOTIFICATION_KINDS[k].locked ? [k] : [];
    for (const kind of kinds) prefs[kind] = { ...(prefs[kind] ?? {}), email: false };
    await admin.from('notification_prefs').update({ prefs, updated_at: new Date().toISOString() }).eq('user_id', row.user_id);
    what = k === 'alerts' ? 'alert emails' : `${NOTIFICATION_KINDS[k]?.label.toLowerCase() ?? 'these'} emails`;
  }
  await audit(row.user_id, 'email.unsubscribe', 'user', row.user_id, null, { kind: k });
  await addNotification(row.user_id, { kind: 'account', title: `You unsubscribed from ${what}`, body: 'You can switch emails back on under Account, Notifications.', link: '#notifications' });
  if (req.method === 'POST') return json({ ok: true });
  return page('You are unsubscribed', `We will stop sending you ${what}. In-app notifications carry on, and you can switch emails back on in Arzish under Account, Notifications.`);
}
