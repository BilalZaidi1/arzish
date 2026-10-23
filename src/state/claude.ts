// Access to the artifact runtime capabilities (sample, db, user, downloads). Always optional.

const cache = new Map<string, Promise<unknown>>();

export function getCap<T = unknown>(name: string): Promise<T | null> {
  if (cache.has(name)) return cache.get(name) as Promise<T | null>;
  const c = typeof window !== 'undefined' ? window.claude : undefined;
  let p: Promise<unknown>;
  if (!c || typeof c.use !== 'function') p = Promise.resolve(null);
  else {
    try {
      p = c.use(name).then((x) => x ?? null).catch(() => null);
    } catch {
      p = Promise.resolve(null);
    }
  }
  cache.set(name, p);
  return p as Promise<T | null>;
}

export interface SampleError {
  code: string;
  message: string;
  text?: string;
}

export interface SampleTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute: (input: Record<string, unknown>, ctx: { signal: AbortSignal }) => unknown;
}

export interface SampleOptions {
  onText?: (u: { text: string; delta: string }) => void;
  signal?: AbortSignal;
  tools?: SampleTool[];
  images?: Blob | Blob[] | FileList;
  modelTier?: 'default' | 'complex' | 'quick';
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  cache?: boolean | { gcTime?: number; refresh?: boolean };
}

export interface SampleResult {
  text: string;
  truncated: boolean;
  modelTierApplied: string;
  modelApplied?: string;
}

export interface SampleFn {
  (input: string | { role: 'user' | 'assistant'; content: string }[], options?: SampleOptions): Promise<SampleResult>;
  json<T = unknown>(input: string | { role: 'user' | 'assistant'; content: string }[], options?: SampleOptions): Promise<T>;
  limits(): Promise<{ maxPromptBytes: number; images?: { maxCount: number; maxInputBytes: number; mediaTypes: string[] }; tools?: { maxCount: number } }>;
}

export const OPUS_MODEL = 'claude-opus-5-5';

/** What to say when the AI is not available in this view at all. */
export function aiUnavailableCopy(what: 'analyst' | 'reader' = 'analyst'): string {
  if (__WEB__) return what === 'reader' ? 'Sign in to use the AI reader. You can still import a CSV.' : 'Sign in to use the AI analyst. Every other screen works without an account.';
  return what === 'reader' ? 'The AI reader works when this page is opened inside Claude. You can still import a CSV.' : 'The AI analyst runs when this page is opened in Claude, using your own Claude account. Every other screen works here.';
}

export function aiErrorCopy(e: unknown): string {
  const code = (e as SampleError)?.code;
  const message = (e as SampleError)?.message;
  switch (code) {
    case 'signin_required':
      return 'Sign in to use the AI analyst.';
    case 'quota_exceeded':
      return `${message || 'You have used this month’s AI questions.'} Upgrade for more, or wait for next month.`;
    case 'pro_required':
      return message || 'This needs the Pro plan.';
    case 'ai_not_configured':
    case 'ai_paused':
      return message || 'The AI analyst is not available right now.';
    case 'overloaded':
      return 'The AI service is busy right now. Try again shortly.';
    case 'not_granted':
      return 'Claude access was not allowed for this page. You can allow it from the page’s permissions menu.';
    case 'sampling_disabled':
      return 'Claude is not available for this account.';
    case 'rate_limited':
      return __WEB__ && message ? message : 'Too many requests right now, or your usage limit was reached. Try again in a little while.';
    case 'session_expired':
      return __WEB__ ? 'Your session expired. Sign in again, then retry.' : 'Your session expired. Sign in to Claude again, then retry.';
    case 'prompt_too_large':
      return 'That request was too large. Try asking about fewer holdings at once.';
    case 'refused':
      return 'The AI declined that request. Try rephrasing it.';
    case 'network':
      return message || 'Could not reach the AI service. Check your connection and try again.';
    case 'invalid_json':
      return 'The answer came back in an unexpected format. Try again.';
    case 'images_unavailable':
      return 'Image upload is not available here. Paste the statement text instead.';
    case 'image_rejected':
      return 'That image could not be read. Use a JPEG or PNG under 20 MB.';
    case 'tools_unavailable':
      return 'This view cannot run analysis tools. Ask a question that does not need calculations.';
    case 'cancelled':
      return 'Stopped.';
    default:
      return __WEB__ ? message || 'Something went wrong with the AI request. Try again.' : 'Something went wrong reaching Claude. Try again.';
  }
}

export function isHardUnavailable(e: unknown): boolean {
  const code = (e as SampleError)?.code;
  return code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed';
}
