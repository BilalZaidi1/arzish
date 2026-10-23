// AI proxy: the browser runs the tool loop, this route forwards each step to the Claude API with the
// server's key, enforces the plan's monthly allowance and cost cap, and records usage.
import { admin, CORS, fail, getUser, planFor, setting } from '../_shared/shared.ts';

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const EFFORTS = new Set(['low', 'medium', 'high']);
const BLOCKS = new Set(['text', 'image', 'document', 'tool_use', 'tool_result', 'thinking', 'redacted_thinking']);
const DEFAULT_PRICE: Record<string, { in: number; out: number; cw: number; cr: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, cw: 5, cr: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, cw: 2.5, cr: 0.1 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cw: 0.125, cr: 0.01 },
};

type Json = Record<string, any>;

interface AiBody {
  messages?: Json[];
  system?: string;
  tools?: Json[];
  effort?: string;
  max_tokens?: number;
  quick?: boolean;
  feature?: string;
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Dollars spent on AI by this user this month (since the month start or the last admin reset). */
async function monthCost(userId: string): Promise<number> {
  const { data: prof } = await admin.from('profiles').select('ai_reset_at').eq('id', userId).maybeSingle();
  const start = [monthStartIso(), prof?.ai_reset_at ?? ''].sort().at(-1)!;
  const { data } = await admin.from('ai_usage').select('cost_usd').eq('user_id', userId).gte('at', start).limit(5000);
  return (data ?? []).reduce((s: number, r: Json) => s + Number(r.cost_usd ?? 0), 0);
}

function hasMedia(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((b: Json) => b?.type === 'image' || b?.type === 'document' || (b?.type === 'tool_result' && hasMedia(b.content)));
}

function upstreamError(status: number, text: string): Response {
  let msg = '';
  try {
    msg = String(JSON.parse(text)?.error?.message ?? '');
  } catch {
    msg = '';
  }
  if (status === 400 && /too long|too large|exceed/i.test(msg)) return fail(413, 'prompt_too_large', 'That request was too large. Ask about fewer holdings at once.');
  if (status === 400) return fail(400, 'bad_request', msg.slice(0, 300) || 'The AI service rejected the request.');
  if (status === 401 || status === 403) return fail(503, 'ai_not_configured', 'The AI key was rejected. An admin needs to check it.');
  if (status === 413) return fail(413, 'prompt_too_large', 'That request was too large. Ask about fewer holdings at once.');
  if (status === 429) return fail(429, 'rate_limited', 'The AI service is busy. Try again in a minute.');
  return fail(503, 'overloaded', 'The AI service is busy right now. Try again shortly.');
}

export async function ai(req: Request): Promise<Response> {
  if (req.method !== 'POST') return fail(405, 'method_not_allowed');
  const user = await getUser(req);
  if (!user) return fail(401, 'signin_required', 'Sign in to use the AI analyst.');
  if ((await setting<boolean>('ai_enabled', true)) === false) return fail(503, 'ai_paused', 'The AI analyst is paused for maintenance. Try again later.');
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return fail(503, 'ai_not_configured', 'The AI analyst is not switched on yet.');

  const raw = await req.text();
  if (raw.length > 6_000_000) return fail(413, 'prompt_too_large', 'That request was too large. Use fewer or smaller images.');
  let body: AiBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'bad_request', 'Malformed request.');
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length || messages.length > 120) return fail(400, 'bad_request', 'No messages to send.');
  let media = false;
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return fail(400, 'bad_request', 'Bad message role.');
    if (typeof m.content === 'string') continue;
    if (!Array.isArray(m.content)) return fail(400, 'bad_request', 'Bad message content.');
    for (const b of m.content) if (!b || !BLOCKS.has(b.type)) return fail(400, 'bad_request', 'Unsupported content block.');
    if (hasMedia(m.content)) media = true;
  }
  const last = messages[messages.length - 1];
  const continuing = last.role === 'user' && Array.isArray(last.content) && last.content.length > 0 && last.content.every((b: Json) => b.type === 'tool_result');
  const newQuestion = !continuing;

  const plan = await planFor(user.id);
  const limits = (plan.limits ?? {}) as Record<string, number | boolean>;
  if (media && !limits.import) return fail(402, 'pro_required', 'Reading statements from images is part of Pro.', { plan: plan.plan });

  // Burst guard: at most 30 calls a minute per person (a long tool loop stays well under this).
  const { count: recent } = await admin.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('at', new Date(Date.now() - 60_000).toISOString());
  if ((recent ?? 0) >= 30) return fail(429, 'rate_limited', 'Too many AI requests in a minute. Wait a moment and try again.');

  const { data: usedRaw } = await admin.rpc('ai_used', { uid: user.id });
  const used = Number(usedRaw ?? 0);
  const limit = Number(limits.ai_month ?? 0);
  // Monthly cost cap in US dollars: the plan's own, else 10 cents per question in the allowance.
  const usdCap = Number(limits.ai_usd_month ?? limit * 0.1);
  if (newQuestion && used >= limit) {
    return fail(429, 'quota_exceeded', limit > 0 ? `You have used your ${limit} AI questions for this month.` : 'Your plan does not include AI questions.', { used, limit, plan: plan.plan });
  }
  if (usdCap > 0 && (await monthCost(user.id)) >= usdCap) {
    return fail(429, 'quota_exceeded', 'You have reached this month’s AI allowance.', { used, limit, plan: plan.plan });
  }

  const model = String(body.quick ? await setting('ai_model_quick', 'claude-opus-5-5') : await setting('ai_model', 'claude-opus-5-5'));
  const effort = typeof body.effort === 'string' && EFFORTS.has(body.effort) ? body.effort : undefined;
  const maxTokens = Math.max(1024, Math.min(32000, Math.round(Number(body.max_tokens) || 16000)));
  const tools = Array.isArray(body.tools)
    ? body.tools.slice(0, 24).map((t: Json) => ({
        name: String(t?.name ?? '').slice(0, 64),
        description: String(t?.description ?? '').slice(0, 4000),
        input_schema: t?.input_schema && typeof t.input_schema === 'object' ? t.input_schema : { type: 'object', properties: {} },
      })).filter((t) => /^[a-zA-Z0-9_-]{1,64}$/.test(t.name))
    : [];
  const system = typeof body.system === 'string' && body.system.trim() ? body.system.slice(0, 80_000) : undefined;
  const upstream = {
    model,
    max_tokens: maxTokens,
    stream: true,
    cache_control: { type: 'ephemeral' },
    messages,
    ...(system ? { system } : {}),
    ...(tools.length ? { tools } : {}),
    ...(effort ? { output_config: { effort } } : {}),
    metadata: { user_id: user.id },
  };

  let up: Response;
  try {
    up = await fetch(ANTHROPIC, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(upstream),
    });
  } catch {
    return fail(503, 'overloaded', 'Could not reach the AI service. Try again shortly.');
  }
  if (!up.ok || !up.body) return upstreamError(up.status, await up.text().catch(() => ''));

  // Pass the event stream through untouched while reading the token counts for the usage log.
  const prices = (await setting<Record<string, { in: number; out: number; cw: number; cr: number }>>('ai_price', DEFAULT_PRICE))[model] ?? DEFAULT_PRICE[model] ?? DEFAULT_PRICE['claude-opus-5-5'];
  const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, started: false };
  const feature = newQuestion ? (typeof body.feature === 'string' ? body.feature.replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'chat' : 'chat') : 'tool-loop';
  const take = (u: Json | undefined) => {
    if (!u) return;
    if (typeof u.input_tokens === 'number') usage.input = Math.max(usage.input, u.input_tokens);
    if (typeof u.cache_creation_input_tokens === 'number') usage.cacheWrite = Math.max(usage.cacheWrite, u.cache_creation_input_tokens);
    if (typeof u.cache_read_input_tokens === 'number') usage.cacheRead = Math.max(usage.cacheRead, u.cache_read_input_tokens);
    if (typeof u.output_tokens === 'number') usage.output = Math.max(usage.output, u.output_tokens);
  };
  let buf = '';
  const dec = new TextDecoder();
  const parse = (chunk: Uint8Array) => {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = ev.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        const d = JSON.parse(line.slice(5).trim());
        if (d.type === 'message_start') {
          usage.started = true;
          take(d.message?.usage);
        } else if (d.type === 'message_delta') take(d.usage);
      } catch {
        // not JSON; ignore
      }
    }
  };
  let logged = false;
  const log = async () => {
    if (logged || !usage.started) return;
    logged = true;
    const cost = (usage.input * prices.in + usage.cacheWrite * prices.cw + usage.cacheRead * prices.cr + usage.output * prices.out) / 1e6;
    await admin.from('ai_usage').insert({
      user_id: user.id, model, feature,
      input_tokens: usage.input + usage.cacheWrite + usage.cacheRead,
      output_tokens: usage.output,
      cost_usd: Math.round(cost * 1e6) / 1e6,
    });
  };
  const reader = up.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await log();
          ctl.close();
          return;
        }
        parse(value);
        ctl.enqueue(value);
      } catch (e) {
        await log();
        ctl.error(e);
      }
    },
    async cancel() {
      try {
        await reader.cancel();
      } catch {
        // already closed
      }
      await log();
    },
  });
  return new Response(stream, {
    headers: {
      ...CORS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Arzish-Model': model,
      'X-Arzish-AI-Used': String(used + (newQuestion ? 1 : 0)),
      'X-Arzish-AI-Limit': String(limit),
      'Access-Control-Expose-Headers': 'X-Arzish-Model, X-Arzish-AI-Used, X-Arzish-AI-Limit',
    },
  });
}
