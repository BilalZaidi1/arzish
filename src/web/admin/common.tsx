// Shared pieces for the back office: admin actions, data loading, small formatting helpers.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../supabase';
import { fmtDate } from '../../engine/format';
import { Callout, Spinner } from '../../ui/components/primitives';

export type Json = Record<string, any>;

/** Run a back-office action on the server (checked against the admin role and audited). */
export function act<T = Json>(action: string, payload: Json = {}): Promise<T> {
  return api<T>('admin', { action, ...payload });
}

export function useLoad<T>(fn: () => PromiseLike<T> | Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    Promise.resolve(fnRef.current())
      .then((d) => {
        if (n !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e) => n === seq.current && setError(errorText(e)))
      .finally(() => n === seq.current && setLoading(false));
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  return { data, error, loading, reload };
}

/** Unwrap a Supabase query result, throwing its error. */
export async function rows<T = Json>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw { message: error.message };
  return data as T;
}

export function Loading({ error, loading }: { error?: string | null; loading?: boolean }) {
  if (error) return <Callout tone="warn">{error}</Callout>;
  if (loading) return <div className="row small muted"><Spinner /> Loading…</div>;
  return null;
}

export const dt = (iso?: string | null): string => (iso ? `${fmtDate(iso.slice(0, 10))} ${iso.slice(11, 16)}` : '–');
export const d = (iso?: string | null): string => (iso ? fmtDate(iso.slice(0, 10)) : '–');
export const n = (v: unknown): string => (typeof v === 'number' && isFinite(v) ? v.toLocaleString('en-US') : v === null || v === undefined ? '–' : String(v));
export const usd = (v: unknown): string => (typeof v === 'number' || typeof v === 'string' ? `$${Number(v).toFixed(2)}` : '–');
export const pkr = (v: unknown): string => (typeof v === 'number' || (typeof v === 'string' && v !== '') ? `Rs ${Math.round(Number(v)).toLocaleString('en-US')}` : '–');

export function planLabel(p: Json | null | undefined): string {
  if (!p) return '–';
  if (p.status === 'trialing') return `${p.name} trial`;
  if (p.status === 'free') return 'Free';
  return `${p.name}${p.status && p.status !== 'active' ? ` (${String(p.status).replace('_', ' ')})` : ''}`;
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="w-json">{JSON.stringify(value, null, 2)}</pre>;
}

export function Kpi({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: 'warn' | 'good' }) {
  return (
    <div className={'stat' + (tone ? ` w-kpi-${tone}` : '')}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}
