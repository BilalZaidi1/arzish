// Email through Resend, with one branded layout and a delivery log.
import { admin, getSecret, setting } from './shared.ts';

const ACCENT = '#2443C8';
const INK = '#0C1322';
const INK2 = '#475069';
const BG = '#F2F4F8';

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface LayoutOpts {
  title: string;
  preheader?: string;
  intro?: string;
  /** Body HTML already escaped where needed. */
  body?: string;
  cta?: { label: string; url: string };
  note?: string;
  unsubscribeUrl?: string;
  settingsUrl?: string;
}

export function layout(o: LayoutOpts): string {
  const btn = o.cta
    ? `<p style="margin:24px 0 8px"><a href="${esc(o.cta.url)}" style="background:${ACCENT};color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600;display:inline-block">${esc(o.cta.label)}</a></p>`
    : '';
  const foot = [
    o.settingsUrl ? `<a href="${esc(o.settingsUrl)}" style="color:${INK2}">Email settings</a>` : '',
    o.unsubscribeUrl ? `<a href="${esc(o.unsubscribeUrl)}" style="color:${INK2}">Unsubscribe</a>` : '',
  ].filter(Boolean).join(' &middot; ');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:Archivo,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
<span style="display:none;max-height:0;overflow:hidden">${esc(o.preheader ?? '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #E1E5EE">
<tr><td style="padding:22px 28px 0"><span style="font-weight:700;font-size:18px;letter-spacing:0.02em;color:${ACCENT}">ARZISH</span></td></tr>
<tr><td style="padding:14px 28px 28px;font-size:15px;line-height:1.55">
<h1 style="font-size:20px;line-height:1.3;margin:0 0 12px;color:${INK}">${esc(o.title)}</h1>
${o.intro ? `<p style="margin:0 0 12px;color:${INK}">${esc(o.intro)}</p>` : ''}
${o.body ?? ''}
${btn}
${o.note ? `<p style="margin:16px 0 0;font-size:13px;color:${INK2}">${esc(o.note)}</p>` : ''}
</td></tr></table>
<p style="max-width:560px;margin:14px auto 0;font-size:12px;line-height:1.5;color:${INK2}">Arzish shows estimates for education and planning, not investment advice.${foot ? `<br>${foot}` : ''}</p>
</td></tr></table></body></html>`;
}

/** A simple two-column table for figures. */
export function table(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 4px;font-size:14px">${rows
    .map(([k, v]) => `<tr><td style="padding:7px 0;border-bottom:1px solid #EEF1F6;color:${INK2}">${esc(k)}</td><td style="padding:7px 0;border-bottom:1px solid #EEF1F6;text-align:right;font-weight:600">${esc(v)}</td></tr>`)
    .join('')}</table>`;
}

export function list(items: string[]): string {
  return `<ul style="margin:8px 0;padding-left:20px">${items.map((i) => `<li style="margin:6px 0">${i}</li>`).join('')}</ul>`;
}

export interface SendOpts {
  to: string;
  subject: string;
  html: string;
  text: string;
  kind: string;
  userId?: string | null;
  unsubscribeUrl?: string;
  idempotencyKey?: string;
  replyTo?: string;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(o: SendOpts): Promise<SendResult> {
  const key = await getSecret('resend_api_key');
  const from = await setting<string>('email_from', 'Arzish <onboarding@resend.dev>');
  if (!key) {
    await admin.from('email_log').insert({ user_id: o.userId ?? null, to_email: o.to, kind: o.kind, subject: o.subject, status: 'skipped', error: 'no email key' });
    return { ok: false, error: 'email_not_configured' };
  }
  const headers: Record<string, string> = {};
  if (o.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${o.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(o.idempotencyKey ? { 'Idempotency-Key': o.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({ from, to: [o.to], subject: o.subject, html: o.html, text: o.text, headers, ...(o.replyTo ? { reply_to: o.replyTo } : {}), tags: [{ name: 'kind', value: o.kind.replace(/[^a-zA-Z0-9_-]/g, '_') }] }),
    });
  } catch (e) {
    const error = `network: ${(e as Error).message}`.slice(0, 300);
    await admin.from('email_log').insert({ user_id: o.userId ?? null, to_email: o.to, kind: o.kind, subject: o.subject, status: 'failed', error });
    return { ok: false, error };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = `${res.status}: ${body?.message ?? body?.name ?? 'send failed'}`.slice(0, 300);
    await admin.from('email_log').insert({ user_id: o.userId ?? null, to_email: o.to, kind: o.kind, subject: o.subject, status: 'failed', error });
    return { ok: false, error };
  }
  await admin.from('email_log').insert({ user_id: o.userId ?? null, to_email: o.to, kind: o.kind, subject: o.subject, status: 'sent', provider_id: body?.id ?? null });
  return { ok: true, id: body?.id };
}

export async function appUrl(path = ''): Promise<string> {
  const base = String(await setting<string>('app_url', '')).replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}

export async function unsubscribeUrl(token: string, kind: string): Promise<string> {
  const fnBase = `${Deno.env.get('SUPABASE_URL')}/functions/v1/api/unsubscribe`;
  return `${fnBase}?t=${encodeURIComponent(token)}&k=${encodeURIComponent(kind)}`;
}
