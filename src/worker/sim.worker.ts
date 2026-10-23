// Web Worker entry: runs simulations off the main thread.
import { simulate } from '../engine/simulate';
import type { SimInput, SimResult } from '../engine/simtypes';

const ctx = self as unknown as { onmessage: ((ev: MessageEvent) => void) | null; postMessage: (msg: unknown, transfer?: Transferable[]) => void };

function transferables(res: SimResult): Transferable[] {
  const list: ArrayBuffer[] = [
    res.terminalNominal.buffer as ArrayBuffer,
    res.terminalReal.buffer as ArrayBuffer,
    res.terminalLiquid.buffer as ArrayBuffer,
    res.unitTerminal.buffer as ArrayBuffer,
    ...res.keepValues.map((a) => a.buffer as ArrayBuffer),
    ...res.keepUnits.map((a) => a.buffer as ArrayBuffer),
    ...res.keepCpi.map((a) => a.buffer as ArrayBuffer),
  ];
  if (res.assetEnd) list.push(res.assetEnd.buffer as ArrayBuffer);
  return Array.from(new Set(list));
}

ctx.onmessage = (ev: MessageEvent) => {
  const { id, input } = ev.data as { id: number; input: SimInput };
  try {
    const res = simulate(input);
    ctx.postMessage({ id, ok: true, res }, transferables(res));
  } catch (e) {
    ctx.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
