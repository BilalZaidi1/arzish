// The web edition's stand-in for the artifact "sample" capability: the same call shape the app's AI
// screens use, backed by Arzish's /api/ai route. The tool loop runs here in the browser; each step is
// one streamed Claude call made by the server with Arzish's key and the person's plan allowance.
import { FN_URL, SUPABASE_KEY } from './config';
import { accessToken } from './supabase';
import type { SampleOptions, SampleResult, SampleTool } from '../state/claude';

type Block = Record<string, any>;
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
type Turn = { role: 'user' | 'assistant'; content: string };

export interface AiLimits {
  images: boolean;
}

const fail = (code: string, message: string, extra: Record<string, unknown> = {}) => ({ code, message, ...extra });

function notifyUpgrade(reason: string) {
  try {
    window.dispatchEvent(new CustomEvent('arzish:upgrade', { detail: { reason } }));
  } catch {
    // no window
  }
}

function notifyUsage(used: number, limit: number) {
  try {
    window.dispatchEvent(new CustomEvent('arzish:ai-usage', { detail: { used, limit } }));
  } catch {
    // no window
  }
}

/** Downscale and re-encode an image so a statement screenshot stays well under the request limit. */
async function imageBlock(blob: Blob): Promise<Block> {
  let out: Blob = blob;
  let type = blob.type || 'image/png';
  try {
    if (blob.size > 900_000 && typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      out = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.86));
      type = 'image/jpeg';
    }
  } catch {
    out = blob;
  }
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) throw fail('image_rejected', 'Use a PNG, JPEG or WebP image.');
  const buf = new Uint8Array(await out.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { type: 'image', source: { type: 'base64', media_type: type, data: btoa(bin) } };
}

interface StepResult {
  content: Block[];
  stop: string;
  model?: string;
}

/** One streamed call to /api/ai; text deltas go to onDelta as they arrive. */
async function step(body: Record<string, unknown>, signal: AbortSignal | undefined, onDelta: (d: string) => void): Promise<StepResult> {
  const token = await accessToken();
  if (!token) throw fail('signin_required', 'Sign in to use the AI analyst.');
  let res: Response;
  try {
    res = await fetch(`${FN_URL}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw fail('cancelled', 'Stopped.');
    throw fail('network', 'Could not reach the AI service. Check your connection and try again.');
  }
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    const code = String(j.error ?? 'error');
    if (code === 'quota_exceeded' || code === 'pro_required') notifyUpgrade(code === 'pro_required' ? 'import' : 'ai');
    throw fail(code, String(j.message ?? 'The AI request failed. Try again.'), j);
  }
  const used = Number(res.headers.get('X-Arzish-AI-Used'));
  const limit = Number(res.headers.get('X-Arzish-AI-Limit'));
  if (isFinite(used) && isFinite(limit) && limit > 0) notifyUsage(used, limit);

  const blocks: Block[] = [];
  const json: Record<number, string> = {};
  let stop = '';
  let model: string | undefined = res.headers.get('X-Arzish-Model') ?? undefined;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const handle = (d: any) => {
    switch (d.type) {
      case 'message_start':
        model = d.message?.model ?? model;
        break;
      case 'content_block_start':
        blocks[d.index] = { ...d.content_block };
        if (d.content_block?.type === 'tool_use') json[d.index] = '';
        break;
      case 'content_block_delta': {
        const b = blocks[d.index];
        const dl = d.delta ?? {};
        if (!b) break;
        if (dl.type === 'text_delta') {
          b.text = (b.text ?? '') + dl.text;
          onDelta(dl.text);
        } else if (dl.type === 'thinking_delta') b.thinking = (b.thinking ?? '') + (dl.thinking ?? '');
        else if (dl.type === 'signature_delta') b.signature = dl.signature;
        else if (dl.type === 'input_json_delta') json[d.index] = (json[d.index] ?? '') + (dl.partial_json ?? '');
        break;
      }
      case 'content_block_stop': {
        const b = blocks[d.index];
        if (b?.type === 'tool_use') {
          try {
            b.input = json[d.index] ? JSON.parse(json[d.index]) : {};
          } catch {
            b.input = {};
          }
        }
        break;
      }
      case 'message_delta':
        stop = d.delta?.stop_reason ?? stop;
        break;
      case 'error':
        throw fail(d.error?.type === 'overloaded_error' ? 'overloaded' : 'error', d.error?.message ?? 'The AI service stopped unexpectedly.');
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const ev = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = ev.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let d: any;
        try {
          d = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        handle(d);
      }
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw fail('cancelled', 'Stopped.');
    if ((e as { code?: string })?.code) throw e;
    throw fail('network', 'The connection dropped. Try again.');
  }
  return { content: blocks.filter(Boolean), stop, model };
}

function toMessages(input: string | Turn[]): Msg[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  return input.filter((t) => t && typeof t.content === 'string' && t.content.trim()).map((t) => ({ role: t.role, content: t.content }));
}

export function createSample(getLimits: () => AiLimits) {
  async function sample(input: string | Turn[], opts: SampleOptions = {}): Promise<SampleResult> {
    const messages = toMessages(input);
    if (!messages.length || messages[0].role !== 'user') messages.unshift({ role: 'user', content: '(start)' });
    const images = opts.images ? Array.from(opts.images as ArrayLike<Blob>) : [];
    if (images.length) {
      if (!getLimits().images) {
        notifyUpgrade('import');
        throw fail('pro_required', 'Reading statements from images is part of Pro.');
      }
      const last = messages[messages.length - 1];
      const imgs = await Promise.all(images.slice(0, 5).map(imageBlock));
      last.content = [...imgs, { type: 'text', text: String(last.content) }];
    }
    const tools: SampleTool[] = opts.tools ?? [];
    const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema ?? { type: 'object', properties: {} } }));
    const quick = opts.effort === 'low';
    let text = '';
    let truncated = false;
    let model: string | undefined;
    try {
      for (let round = 0; round < 12; round++) {
        if (round > 0 && text && !text.endsWith('\n')) text += '\n\n';
        const r = await step(
          {
            messages,
            ...(toolDefs.length ? { tools: toolDefs } : {}),
            ...(opts.effort ? { effort: opts.effort } : {}),
            quick,
            max_tokens: quick ? 8000 : 16000,
            feature: toolDefs.length ? 'chat' : quick ? 'extract' : 'ask',
          },
          opts.signal,
          (delta) => {
            text += delta;
            opts.onText?.({ text, delta });
          },
        );
        model = r.model ?? model;
        messages.push({ role: 'assistant', content: r.content });
        if (r.stop === 'max_tokens') {
          truncated = true;
          break;
        }
        if (r.stop !== 'tool_use') break;
        const results: Block[] = [];
        for (const u of r.content.filter((b) => b.type === 'tool_use')) {
          const tool = tools.find((t) => t.name === u.name);
          let content = '';
          let isError = false;
          try {
            const out = tool ? await tool.execute(u.input ?? {}, { signal: opts.signal ?? new AbortController().signal }) : { error: `Unknown tool ${u.name}` };
            content = typeof out === 'string' ? out : JSON.stringify(out ?? null);
          } catch (e) {
            isError = true;
            content = String((e as Error)?.message ?? e);
          }
          results.push({ type: 'tool_result', tool_use_id: u.id, content: content.slice(0, 60_000), ...(isError ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
      }
    } catch (e) {
      throw { ...(e as object), text: text.trim() || undefined };
    }
    return { text: text.trim(), truncated, modelTierApplied: 'complex', modelApplied: model };
  }

  sample.json = async function json<T = unknown>(input: string | Turn[], opts: SampleOptions = {}): Promise<T> {
    const r = await sample(input, opts);
    let t = r.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      return JSON.parse(t) as T;
    } catch {
      const a = t.search(/[[{]/);
      const z = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
      if (a >= 0 && z > a) {
        t = t.slice(a, z + 1);
        try {
          return JSON.parse(t) as T;
        } catch {
          // fall through
        }
      }
      throw fail('invalid_json', 'The answer came back in an unexpected format.', { text: r.text });
    }
  };

  sample.limits = async () => ({
    maxPromptBytes: 900_000,
    images: getLimits().images ? { maxCount: 5, maxInputBytes: 20_000_000, mediaTypes: ['image/png', 'image/jpeg', 'image/webp'] } : undefined,
    tools: { maxCount: 24 },
  });

  return sample;
}
