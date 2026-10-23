// Workspace persistence: private per-user document in the artifact database, with a browser cache.

import { migrateWorkspace } from '../engine/samples';
import type { Workspace } from '../engine/types';
import { getCap } from './claude';

let LS_KEY = 'arzish.workspace.v1';

/** The web edition keeps one browser copy per account (and one for the signed-out demo). */
export function setLocalKey(key: string) {
  LS_KEY = key;
}

export function loadLocal(): Workspace | null {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? migrateWorkspace(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}

export function saveLocal(ws: Workspace): boolean {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ws));
    return true;
  } catch {
    return false;
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

export type SaveOutcome = 'ok' | 'readonly' | 'too_large' | 'error';

export interface CloudStore {
  load(): Promise<Workspace | null>;
  save(ws: Workspace): Promise<SaveOutcome>;
}

interface DbDoc {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(data: Record<string, unknown>): Promise<void>;
}
interface DbNs {
  doc(path: string): DbDoc;
}
interface UserNs {
  id(): Promise<string | null>;
}

export async function connectCloud(): Promise<CloudStore | null> {
  const [db, user] = await Promise.all([getCap<DbNs>('db'), getCap<UserNs>('user')]);
  if (!db || !user) return null;
  let id: string | null = null;
  try {
    id = await user.id();
  } catch {
    id = null;
  }
  if (!id) return null;
  let ref: DbDoc;
  try {
    ref = db.doc(`data/users/${id}/workspace`);
  } catch {
    return null;
  }
  return {
    async load() {
      try {
        const snap = await ref.get();
        if (!snap.exists) return null;
        const d = snap.data();
        const raw = typeof d?.ws === 'string' ? JSON.parse(d.ws as string) : d;
        return migrateWorkspace(raw);
      } catch {
        return null;
      }
    },
    async save(ws) {
      const json = JSON.stringify(ws);
      if (json.length > 250_000) return 'too_large';
      try {
        await ref.set({ ws: json, savedAt: new Date().toISOString(), v: ws.version });
        return 'ok';
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'invalid_argument' || code === 'not_granted' || code === 'revoked') return 'readonly';
        if (code === 'quota_exceeded') return 'too_large';
        return 'error';
      }
    },
  };
}
