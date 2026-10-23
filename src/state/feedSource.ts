// Reads the daily market data the scheduled agent publishes into this artifact's shared store.
// Readable by every signed-in viewer; only the owner's agent writes it.

import { parseFeed, parseFunds, parsePsx, type FeedDoc, type FundsDoc, type PsxDoc } from '../engine/feed';
import { getCap } from './claude';

interface DbDoc {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
}
interface DbNs {
  doc(path: string): DbDoc;
}

async function read(path: string): Promise<unknown> {
  const db = await getCap<DbNs>('db');
  if (!db) return null;
  try {
    const snap = await db.doc(path).get();
    return snap.exists ? snap.data() ?? null : null;
  } catch {
    return null;
  }
}

export async function loadFeed(): Promise<FeedDoc | null> {
  return parseFeed(await read('market/latest'));
}

export async function loadFunds(): Promise<FundsDoc | null> {
  return parseFunds(await read('market/funds'));
}

export async function loadPsx(): Promise<PsxDoc | null> {
  return parsePsx(await read('market/psx'));
}
