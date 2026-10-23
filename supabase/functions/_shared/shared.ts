// Shared helpers for Arzish edge functions: admin client, secrets, auth, JSON responses,
// audit log and in-app notifications.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const k = JSON.parse(keys);
      if (k && typeof k.default === 'string') return k.default;
    } catch {
      // fall through to the legacy key
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

export const admin = createClient(SUPABASE_URL, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } });
}

export function fail(status: number, error: string, message?: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, message: message ?? error, ...extra }, status);
}

const secretCache = new Map<string, string | null>();
export async function getSecret(name: string): Promise<string | null> {
  if (secretCache.has(name)) return secretCache.get(name)!;
  const { data, error } = await admin.rpc('get_secret', { secret_name: name });
  const v = error ? null : ((data as string | null) ?? null);
  secretCache.set(name, v);
  return v;
}

export async function isCron(req: Request): Promise<boolean> {
  const got = req.headers.get('x-cron-secret');
  if (!got) return false;
  const want = await getSecret('cron_secret');
  return !!want && timingSafeEqual(got, want);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export interface AuthedUser {
  id: string;
  email: string;
}

/** The signed-in user behind the request's bearer token, or null. Disabled accounts count as signed out. */
export async function getUser(req: Request): Promise<AuthedUser | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.startsWith('sb_')) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: prof } = await admin.from('profiles').select('disabled').eq('id', data.user.id).maybeSingle();
  if (prof?.disabled) return null;
  return { id: data.user.id, email: (data.user.email ?? '').toLowerCase() };
}

export async function isAdminUser(userId: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('role, disabled').eq('id', userId).maybeSingle();
  return !!data && data.role === 'admin' && !data.disabled;
}

export async function setting<T = unknown>(key: string, fallback: T): Promise<T> {
  const { data } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle();
  return (data?.value ?? fallback) as T;
}

export async function audit(actor: string | null, action: string, targetType: string | null, targetId: string | null, before: unknown = null, after: unknown = null) {
  await admin.from('audit_log').insert({ actor, action, target_type: targetType, target_id: targetId, before, after });
}

export interface NewNotification {
  kind: string;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
  dedupe?: string;
}

/** Add an in-app notification; with a dedupe key the same one is never added twice. Returns the row or null. */
export async function addNotification(userId: string, n: NewNotification): Promise<{ id: number } | null> {
  const row = { user_id: userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null, data: n.data ?? null, dedupe_key: n.dedupe ?? null };
  if (n.dedupe) {
    const { data, error } = await admin.from('notifications').upsert(row, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }).select('id');
    if (error) return null;
    return data && data.length ? (data[0] as { id: number }) : null;
  }
  const { data, error } = await admin.from('notifications').insert(row).select('id').single();
  return error ? null : (data as { id: number });
}

export async function planFor(userId: string): Promise<{ plan: string; name: string; status: string; limits: Record<string, number | boolean>; periodEnd?: string; source?: string }> {
  const { data } = await admin.rpc('plan_for', { uid: userId });
  return (data ?? { plan: 'free', name: 'Free', status: 'free', limits: {} }) as never;
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export const todayPKT = (): string => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

export async function logJob(job: string, ok: boolean, info: unknown) {
  await admin.from('job_runs').insert({ job, ok, info });
}
