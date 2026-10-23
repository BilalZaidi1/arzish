import { getCap, OPUS_MODEL, type SampleFn, type SampleOptions } from '../../state/claude';

export async function getSample(): Promise<SampleFn | null> {
  return getCap<SampleFn>('sample');
}

/** The runtime rejects some options when present at all (for example `cache` next to `tools`),
 *  so never send keys whose value is undefined. */
function clean(o: SampleOptions): SampleOptions {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as SampleOptions;
}

/** Options for an analysis call on Claude Opus 5.5 (falls back to the most capable tier). */
export function opusOptions(depth: 'standard' | 'deep', extra: SampleOptions = {}): SampleOptions {
  return clean({
    model: OPUS_MODEL,
    modelTier: 'complex',
    ...(depth === 'deep' ? { effort: 'high' as const } : {}),
    ...extra,
  });
}

/** Options for short extraction tasks: still Opus 5.5, with light reasoning. */
export function opusQuick(extra: SampleOptions = {}): SampleOptions {
  return clean({ model: OPUS_MODEL, modelTier: 'complex', effort: 'low', ...extra });
}

export function modelLabel(applied?: string, tier?: string): string {
  if (applied === OPUS_MODEL) return 'Claude Opus 5.5';
  if (applied) return applied;
  if (tier === 'complex') return 'Claude (most capable tier)';
  if (tier === 'quick') return 'Claude (fast tier)';
  if (tier) return 'Claude (default tier)';
  return 'Claude';
}
