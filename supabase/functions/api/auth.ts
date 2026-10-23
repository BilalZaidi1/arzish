// Email sign-in codes. Arzish sends its own 6-digit code through Resend, then trades a correct code
// for a one-time Supabase sign-in token the browser exchanges for a session (verifyOtp).
import { admin, fail, getSecret, json, readJson, timingSafeEqual } from '../_shared/shared.ts';
import { layout, sendEmail } from '../_shared/email.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function isDisabled(email: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('disabled').eq('email', email).maybeSingle();
  return !!data?.disabled;
}

export async function authCode(req: Request): Promise<Response> {
  const body = await readJson<{ email?: string; code?: string }>(req);
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return fail(400, 'bad_email', 'Enter a valid email address.');
  if (await isDisabled(email)) return fail(403, 'disabled', 'This account is disabled. Contact support.');
  const pepper = (await getSecret('cron_secret')) ?? '';
  if (body.code === undefined || body.code === null || body.code === '') return send(email, pepper);
  return verify(email, String(body.code).replace(/\D/g, ''), pepper);
}

async function send(email: string, pepper: string): Promise<Response> {
  const { data: row } = await admin.from('auth_codes').select('*').eq('email', email).maybeSingle();
  const now = Date.now();
  let sentCount = 1;
  let windowStart = new Date(now).toISOString();
  if (row) {
    if (now - Date.parse(row.last_sent_at) < 30_000) return fail(429, 'too_soon', 'Wait 30 seconds before asking for another code.');
    const inWindow = now - Date.parse(row.window_start) < 3600_000;
    sentCount = inWindow ? row.sent_count + 1 : 1;
    windowStart = inWindow ? row.window_start : windowStart;
    if (sentCount > 5) return fail(429, 'too_many', 'Too many codes for this address in the last hour. Try again later.');
  }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  const code_hash = await sha256(`${email}:${code}:${pepper}`);
  const { error } = await admin.from('auth_codes').upsert({
    email, code_hash, expires_at: new Date(now + 10 * 60_000).toISOString(), attempts: 0, sent_count: sentCount, window_start: windowStart, last_sent_at: new Date(now).toISOString(),
  });
  if (error) return fail(500, 'store_failed', 'Could not start sign-in. Try again.');
  const html = layout({
    title: 'Your sign-in code',
    preheader: `${code} is your Arzish code`,
    intro: 'Enter this code in Arzish to sign in. It works for 10 minutes.',
    body: `<p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:14px 0;font-family:'JetBrains Mono',Menlo,Consolas,monospace">${code}</p>`,
    note: "If you didn't ask for this code, you can ignore this email.",
  });
  const r = await sendEmail({ to: email, subject: `${code} is your Arzish sign-in code`, html, text: `Your Arzish sign-in code is ${code}. It works for 10 minutes.`, kind: 'signin' });
  if (!r.ok) {
    await admin.from('auth_codes').delete().eq('email', email);
    return fail(502, 'email_failed', 'We could not email a code to that address yet. Use Google sign-in for now.', { detail: r.error });
  }
  return json({ ok: true });
}

async function verify(email: string, code: string, pepper: string): Promise<Response> {
  if (!/^\d{6}$/.test(code)) return fail(400, 'bad_code', 'Enter the 6-digit code from the email.');
  const { data: row } = await admin.from('auth_codes').select('*').eq('email', email).maybeSingle();
  if (!row || Date.parse(row.expires_at) < Date.now()) return fail(400, 'expired', 'That code has expired. Ask for a new one.');
  if (row.attempts >= 5) {
    await admin.from('auth_codes').delete().eq('email', email);
    return fail(429, 'too_many_attempts', 'Too many tries. Ask for a new code.');
  }
  const ok = timingSafeEqual(await sha256(`${email}:${code}:${pepper}`), row.code_hash);
  if (!ok) {
    await admin.from('auth_codes').update({ attempts: row.attempts + 1 }).eq('email', email);
    return fail(400, 'wrong_code', 'That code is not right. Check the email and try again.');
  }
  await admin.from('auth_codes').delete().eq('email', email);
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) return fail(500, 'create_failed', 'Could not create the account. Try again.');
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const token = data?.properties?.hashed_token;
  if (error || !token) return fail(500, 'link_failed', 'Could not finish sign-in. Try again.');
  return json({ ok: true, token_hash: token, type: 'magiclink' });
}
