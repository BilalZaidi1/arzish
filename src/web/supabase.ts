// The Supabase client and small helpers for calling Arzish's edge functions.
import { createClient } from '@supabase/supabase-js';
import { FN_URL, SUPABASE_KEY, SUPABASE_URL } from './config';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: 'arzish-auth' },
});

export interface ApiError {
  code: string;
  message: string;
  status?: number;
  [k: string]: unknown;
}

export async function accessToken(): Promise<string | null> {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

async function post<T>(url: string, body: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
  if (auth) {
    const t = await accessToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  } catch {
    throw { code: 'network', message: 'Could not reach Arzish. Check your connection and try again.' } as ApiError;
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw { ...out, code: out.error ?? `http_${res.status}`, message: out.message ?? 'Something went wrong. Try again.', status: res.status } as ApiError;
  return out as T;
}

/** POST to an /api route (signed-in when a session exists). */
export function api<T = Record<string, unknown>>(route: string, body: unknown = {}): Promise<T> {
  return post<T>(`${FN_URL}/api/${route}`, body);
}

/** Run a scheduled job now (admins only). */
export function runJob<T = Record<string, unknown>>(name: string, body: unknown = {}): Promise<T> {
  return post<T>(`${FN_URL}/jobs/${name}`, body);
}

export function errorText(e: unknown): string {
  const m = (e as ApiError)?.message ?? (e as Error)?.message;
  return typeof m === 'string' && m ? m : 'Something went wrong. Try again.';
}
