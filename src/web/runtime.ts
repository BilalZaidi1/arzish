// window.claude for the web edition: the capability names the shared app already uses ("db", "user",
// "sample", "downloads"), backed by Supabase instead of the artifact runtime.
import { sb } from './supabase';
import { createSample, type AiLimits } from './ai';

type Json = Record<string, unknown>;

interface Snapshot {
  exists: boolean;
  data(): Json | undefined;
}

let currentUserId: string | null = null;
let aiLimits: AiLimits = { images: false };

export function setRuntimeUser(id: string | null) {
  currentUserId = id;
}

export function setAiLimits(l: AiLimits) {
  aiLimits = l;
}

const err = (code: string, message: string) => ({ code, message });

function workspaceDoc(userId: string) {
  return {
    async get(): Promise<Snapshot> {
      const { data, error } = await sb.from('workspaces').select('ws, updated_at, version').eq('user_id', userId).maybeSingle();
      if (error) throw err('unavailable', error.message);
      if (!data) return { exists: false, data: () => undefined };
      return { exists: true, data: () => ({ ws: JSON.stringify(data.ws), savedAt: data.updated_at, v: data.version }) };
    },
    async set(d: Json): Promise<void> {
      if (userId !== currentUserId) throw err('not_granted', 'Signed out');
      let ws: unknown;
      try {
        ws = typeof d.ws === 'string' ? JSON.parse(d.ws as string) : d.ws;
      } catch {
        throw err('invalid_argument', 'Bad workspace');
      }
      const { error } = await sb.from('workspaces').upsert({ user_id: userId, ws, version: Number(d.v) || 1, updated_at: new Date().toISOString() });
      if (error) {
        if (/ws_size|too large|payload/i.test(error.message)) throw err('quota_exceeded', error.message);
        if (/row-level security|permission/i.test(error.message)) throw err('not_granted', error.message);
        throw err('unavailable', error.message);
      }
    },
  };
}

function marketDoc(id: string) {
  return {
    async get(): Promise<Snapshot> {
      const { data, error } = await sb.from('market_docs').select('doc').eq('id', id).maybeSingle();
      if (error || !data) return { exists: false, data: () => undefined };
      return { exists: true, data: () => data.doc as Json };
    },
    async set(): Promise<void> {
      throw err('not_granted', 'Market data is read-only');
    },
  };
}

const db = {
  doc(path: string) {
    const ws = /^data\/users\/([^/]+)\/workspace$/.exec(path);
    if (ws) return workspaceDoc(ws[1]);
    const m = /^market\/(latest|psx|funds)$/.exec(path);
    if (m) return marketDoc(m[1]);
    throw err('invalid_argument', `Unknown document ${path}`);
  },
};

const user = {
  async id(): Promise<string | null> {
    return currentUserId;
  },
};

function mimeFor(name: string): string {
  if (/\.csv$/i.test(name)) return 'text/csv;charset=utf-8';
  if (/\.json$/i.test(name)) return 'application/json';
  if (/\.html?$/i.test(name)) return 'text/html;charset=utf-8';
  if (/\.md$/i.test(name)) return 'text/markdown;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

const downloads = {
  async save({ filename, data }: { filename: string; data: string | Blob }): Promise<{ status: string }> {
    const blob = typeof data === 'string' ? new Blob([data], { type: mimeFor(filename) }) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { status: 'saved' };
  },
};

const sample = createSample(() => aiLimits);

export function installRuntime() {
  const caps: Record<string, unknown> = {
    db,
    // The workspace store is per account; signed-out visitors keep a browser-only demo.
    user: currentUserId ? user : null,
    sample,
    downloads,
  };
  window.claude = {
    use: (name: string) => Promise.resolve(caps[name] ?? null),
  };
}
