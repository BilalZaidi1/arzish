// Runs simulations in a Web Worker (blob URL); falls back to the main thread if workers are blocked.

import workerCode from 'virtual:worker-code';
import { simulate } from '../engine/simulate';
import type { SimInput, SimResult } from '../engine/simtypes';

let worker: Worker | null = null;
let failed = false;
let seq = 0;
const pending = new Map<number, { resolve: (r: SimResult) => void; reject: (e: unknown) => void; input: SimInput }>();

function runLocal(input: SimInput): Promise<SimResult> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(simulate(input));
      } catch (e) {
        reject(e);
      }
    }, 0);
  });
}

function getWorker(): Worker | null {
  if (worker || failed) return worker;
  try {
    const blob = new Blob([workerCode], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    w.onmessage = (ev: MessageEvent) => {
      const { id, ok, res, error } = ev.data as { id: number; ok: boolean; res?: SimResult; error?: string };
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok && res) p.resolve(res);
      else p.reject(new Error(error ?? 'Simulation failed'));
    };
    w.onerror = () => {
      failed = true;
      worker = null;
      const list = Array.from(pending.values());
      pending.clear();
      list.forEach((p) => runLocal(p.input).then(p.resolve, p.reject));
    };
    worker = w;
  } catch {
    failed = true;
    worker = null;
  }
  return worker;
}

export function runSim(input: SimInput): Promise<SimResult> {
  const w = getWorker();
  if (!w) return runLocal(input);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, input });
    try {
      w.postMessage({ id, input });
    } catch (e) {
      pending.delete(id);
      runLocal(input).then(resolve, reject);
    }
  });
}

/** Small LRU cache keyed by a string so views share results. */
const cache = new Map<string, Promise<SimResult>>();
export function runSimCached(key: string, input: SimInput): Promise<SimResult> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const p = runSim(input);
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  while (cache.size > 16) {
    const first = cache.keys().next().value as string;
    cache.delete(first);
  }
  return p;
}

/** Fast non-cryptographic string hash for cache keys. */
export function hashKey(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822507);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}
