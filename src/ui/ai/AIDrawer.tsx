import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TYPE_META } from '../../engine/catalog';
import { fmtQty, todayISO, uid } from '../../engine/format';
import type { ChartSpec, Holding } from '../../engine/types';
import { valuePKR } from '../../engine/valuation';
import { aiErrorCopy, aiUnavailableCopy, isHardUnavailable, type SampleFn, type SampleTool } from '../../state/claude';
import { useUI, useWS } from '../../state/store';
import { ownCounts, useEntitlements } from '../../state/entitlements';
import { Icon } from '../components/Icon';
import { Button, copyText, Seg } from '../components/primitives';
import { useFmt } from '../fmt';
import { getSample, modelLabel, opusOptions } from './client';
import { ANALYST_RULES, buildContext } from './context';
import { Markdown } from './Markdown';
import { normalizeHolding } from './normalize';
import { SpecChart } from './SpecChart';
import { buildTools, TOOL_LABELS } from './tools';
import { extractionPrompt } from '../views/ImportModal';

interface ToolRun {
  key: string;
  label: string;
  done: boolean;
}

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  display?: string;
  charts: ChartSpec[];
  tools: ToolRun[];
  model?: string;
  error?: string;
  staged?: { h: Holding; on: boolean }[];
  stagedDone?: boolean;
  pending?: boolean;
  kind?: 'review';
  pinnedIdx?: number[];
}

// Conversation survives closing the drawer during the visit.
let STORE: Msg[] = [];
let SEQ = 1;

const SUGGESTIONS = [
  'Review my portfolio like an analyst would',
  'What happens to my wealth if the rupee falls 30%?',
  'How much should I invest monthly to reach Rs 5 crore by 2040?',
  'Chart my projected passive income for the next 15 years',
  'Which holdings add the most risk, and what would you change?',
  'How would a Shariah-compliant version of this portfolio look?',
];

const REVIEW_PROMPT = `Write an institutional-style review of this portfolio for its owner. Before writing, call run_forecast, get_risk_report and run_stress_test with the most relevant preset (a rupee devaluation or a PSX crash). Then write:
## Verdict
Two or three sentences with the headline numbers.
## What is working
Three bullets.
## Weaknesses and risks
Three to five bullets with numbers: concentration, rupee exposure, inflation drag, liquidity, tax leakage.
## Goals check
One line per goal with its probability.
## Actions to consider
Three to five numbered actions at the asset-class level, each with its expected effect.
Finish with one line on what to re-check and when. If it helps, draw one chart with render_chart.`;

export function AIDrawer() {
  const { ws, active, updatePortfolio, update } = useWS();
  const ent = useEntitlements();
  const { setAiOpen, aiRequest, go, toast } = useUI();
  const fmt = useFmt();
  const [msgs, setMsgsState] = useState<Msg[]>(STORE);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [avail, setAvail] = useState<'checking' | 'yes' | 'no' | 'blocked'>('checking');
  const [blockedMsg, setBlockedMsg] = useState('');
  const [toolMax, setToolMax] = useState<number | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const state = useRef({ ws, active });
  state.current = { ws, active };
  const handled = useRef<number>(0);
  const depth = ws.settings.aiDepth;

  const setMsgs = useCallback((fn: (m: Msg[]) => Msg[]) => {
    setMsgsState((prev) => {
      const next = fn(prev);
      STORE = next;
      return next;
    });
  }, []);
  const patch = useCallback((id: number, fn: (m: Msg) => Msg) => setMsgs((list) => list.map((m) => (m.id === id ? fn(m) : m))), [setMsgs]);

  useEffect(() => {
    let alive = true;
    // The web edition's AI needs an account; say so up front instead of failing on the first question.
    if (ent.web && !ent.signedIn) {
      setAvail('no');
      return;
    }
    getSample().then(async (s) => {
      if (!alive) return;
      if (!s) return setAvail('no');
      setAvail('yes');
      try {
        const lim = await s.limits();
        setToolMax(lim.tools ? lim.tools.maxCount : 0);
      } catch {
        setToolMax(0);
      }
    });
    return () => {
      alive = false;
    };
  }, [ent.web, ent.signedIn]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  const send = useCallback(async (text: string, opts: { display?: string; kind?: 'review'; quick?: boolean } = {}) => {
    const s: SampleFn | null = await getSample();
    if (!s) {
      setAvail('no');
      return;
    }
    if (busy) return;
    const userMsg: Msg = { id: SEQ++, role: 'user', text, display: opts.display, charts: [], tools: [] };
    const aMsg: Msg = { id: SEQ++, role: 'assistant', text: '', charts: [], tools: [], pending: true, kind: opts.kind };
    const history = STORE.filter((m) => !m.pending);
    setMsgs((list) => [...list, userMsg, aMsg]);
    setInput('');
    setBusy(true);
    ctl.current = new AbortController();
    const aid = aMsg.id;

    // Quick add without tool support: structured extraction instead.
    if (opts.quick && !toolMax) {
      try {
        const out = await s.json<unknown[]>(extractionPrompt(text, false), opusOptions('standard', { signal: ctl.current.signal, effort: 'low' }));
        const list = (Array.isArray(out) ? out : []).map((r) => normalizeHolding(r, state.current.ws.market)).filter((h): h is Holding => !!h);
        patch(aid, (m) => ({ ...m, pending: false, text: list.length ? `I read ${list.length} holding${list.length > 1 ? 's' : ''}. Check them below, then add.` : 'I could not find holdings in that text. Try one per line, with quantity and price or amount.', staged: list.map((h) => ({ h, on: true })) }));
      } catch (e) {
        patch(aid, (m) => ({ ...m, pending: false, error: aiErrorCopy(e) }));
        if (isHardUnavailable(e)) {
          setAvail('blocked');
          setBlockedMsg(aiErrorCopy(e));
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    const rules = ANALYST_RULES + `\n\nThe user is on the "${(document.querySelector('.nav-item[aria-current="page"] .nav-label')?.textContent ?? 'Overview')}" screen.` + (toolMax ? '' : '\nTools are unavailable in this view: answer from the context only and say when a calculation would need the app\'s screens.');
    const turns: { role: 'user' | 'assistant'; content: string }[] = [
      { role: 'user', content: `${rules}\n\nPORTFOLIO CONTEXT\n${buildContext(state.current.ws, state.current.active)}` },
    ];
    for (const m of history.slice(-12)) {
      const content = (m.text || '').trim();
      if (!content) continue;
      turns.push({ role: m.role, content: content.slice(0, 6000) });
    }
    turns.push({ role: 'user', content: text });

    let tools: SampleTool[] | undefined;
    if (toolMax) {
      const raw = buildTools({
        get: () => state.current,
        onChart: (spec) => patch(aid, (m) => ({ ...m, charts: [...m.charts, spec] })),
        onNavigate: (v) => go(v),
        onStage: (list) => patch(aid, (m) => ({ ...m, staged: list.map((h) => ({ h, on: true })) })),
        onProgress: () => undefined,
      });
      tools = raw.slice(0, toolMax).map((t) => ({
        ...t,
        execute: async (inp: Record<string, unknown>, ctx: { signal: AbortSignal }) => {
          const key = t.name + ':' + SEQ++;
          patch(aid, (m) => ({ ...m, tools: [...m.tools, { key, label: TOOL_LABELS[t.name] ?? t.name, done: false }] }));
          try {
            return await t.execute(inp, ctx);
          } finally {
            patch(aid, (m) => ({ ...m, tools: m.tools.map((x) => (x.key === key ? { ...x, done: true } : x)) }));
          }
        },
      }));
    }

    try {
      const res = await s(turns, opusOptions(depth, {
        signal: ctl.current.signal,
        tools,
        cache: tools ? undefined : false,
        onText: ({ text: t }) => patch(aid, (m) => ({ ...m, text: t })),
      }));
      const model = modelLabel(res.modelApplied, res.modelTierApplied);
      patch(aid, (m) => ({ ...m, text: res.text, pending: false, model, error: res.truncated ? 'The answer was cut short. Ask for less at a time.' : undefined }));
      if (opts.kind === 'review') {
        updatePortfolio((p) => ({ ...p, lastReview: { text: res.text, at: new Date().toISOString(), model } }));
      }
    } catch (e) {
      const partial = (e as { text?: string })?.text;
      patch(aid, (m) => ({ ...m, pending: false, text: partial ?? m.text, error: (e as { code?: string })?.code === 'cancelled' ? 'Stopped.' : aiErrorCopy(e) }));
      if (isHardUnavailable(e)) {
        setAvail('blocked');
        setBlockedMsg(aiErrorCopy(e));
      }
    } finally {
      setBusy(false);
      ctl.current = null;
    }
  }, [busy, toolMax, depth, patch, setMsgs, go, updatePortfolio]);

  // Requests from other screens
  useEffect(() => {
    if (!aiRequest || aiRequest.id === handled.current || avail === 'checking') return;
    handled.current = aiRequest.id;
    if (avail !== 'yes') return;
    if (aiRequest.prompt === '__review__') {
      send(REVIEW_PROMPT, { display: 'Review my portfolio', kind: 'review' });
      return;
    }
    if (aiRequest.prompt === '__quickadd__') {
      setQuickAdd(true);
      window.setTimeout(() => taRef.current?.focus(), 50);
      return;
    }
    if (aiRequest.send) send(aiRequest.prompt, { display: aiRequest.display });
    else {
      setInput(aiRequest.prompt);
      window.setTimeout(() => taRef.current?.focus(), 50);
    }
  }, [aiRequest, avail, send]);

  const submit = () => {
    const t = input.trim();
    if (!t || busy) return;
    if (quickAdd) {
      setQuickAdd(false);
      send(`Add these holdings to my portfolio: ${t}\n\nCall stage_holdings with them so I can confirm. Use only numbers I gave; leave missing prices null. Then summarise what you prepared in two sentences and point out anything I should check.`, { display: `Add: ${t}`, quick: true });
    } else send(t);
  };

  const addStaged = (m: Msg) => {
    const chosen = (m.staged ?? []).filter((x) => x.on).map((x) => x.h);
    if (!chosen.length) return;
    const cur = state.current;
    if (!cur.active.isExample && ownCounts(cur.ws.portfolios).holdings + chosen.length > ent.limit('holdings')) {
      ent.upgrade('holdings');
      return;
    }
    updatePortfolio((p) => ({ ...p, holdings: [...p.holdings, ...chosen] }));
    patch(m.id, (x) => ({ ...x, stagedDone: true }));
    toast(`${chosen.length} holdings added`);
  };

  const pin = (m: Msg, i: number) => {
    const spec = m.charts[i];
    const prompt = STORE[STORE.findIndex((x) => x.id === m.id) - 1]?.display ?? STORE[STORE.findIndex((x) => x.id === m.id) - 1]?.text;
    updatePortfolio((p) => ({ ...p, pinned: [...p.pinned, { id: uid('pin'), title: spec.title, spec, prompt: prompt?.slice(0, 400), createdAt: todayISO() }] }));
    patch(m.id, (x) => ({ ...x, pinnedIdx: [...(x.pinnedIdx ?? []), i] }));
    toast('Pinned to AI insights');
  };

  return (
    <aside className="drawer" aria-label="AI analyst">
      <div className="ai-head">
        <div className="ai-mark"><Icon name="sparkle" /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ai-title">Ask Arzish</div>
          <div className="tiny muted">{__WEB__ ? 'Claude AI · runs this app’s engine' : 'Claude Opus 5.5 · runs this app’s engine'}</div>
        </div>
        <Seg size="sm" label="Analysis depth" value={depth} onChange={(v) => update((w) => ({ ...w, settings: { ...w.settings, aiDepth: v } }))} options={[{ value: 'standard', label: 'Standard' }, { value: 'deep', label: 'Deep', title: 'Thinks longer; slower' }]} />
        {msgs.length > 0 && <Button size="sm" variant="ghost" iconOnly icon="trash" onClick={() => setMsgs(() => [])} disabled={busy}>Clear conversation</Button>}
        <Button size="sm" variant="ghost" iconOnly icon="close" onClick={() => setAiOpen(false)}>Close</Button>
      </div>
      <div className="ai-body" ref={bodyRef}>
        {avail === 'no' && (
          <div className="callout info">
            <Icon name="info" />
            <div className="stack" style={{ gap: 8 }}>
              <div>{aiUnavailableCopy('analyst')}</div>
              {ent.web && !ent.signedIn && <div><Button size="sm" variant="primary" icon="user" onClick={ent.signIn}>Sign in</Button></div>}
            </div>
          </div>
        )}
        {avail === 'blocked' && <div className="callout warn"><Icon name="alert" /><div>{blockedMsg}</div></div>}
        {msgs.length === 0 && avail !== 'no' && (
          <div className="stack">
            <p className="small ink2">Ask about your portfolio in plain words. The analyst can run forecasts, stress tests, risk reports and the optimizer, and it can draw charts you can pin. {ent.web ? (ent.ai ? `${Math.max(0, ent.ai.limit - ent.ai.used)} of ${ent.ai.limit} questions left this month.` : 'Sign in to ask questions.') : 'Answers use your Claude usage; the first request asks permission.'}</p>
            <div className="prompt-chips">
              {SUGGESTIONS.map((q) => (
                <button key={q} type="button" disabled={avail !== 'yes' || busy} onClick={() => (q.startsWith('Review') ? send(REVIEW_PROMPT, { display: q, kind: 'review' }) : send(q))}>{q}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={'msg ' + m.role}>
            {m.role === 'user' ? (
              <div className="bubble">{m.display ?? m.text}</div>
            ) : (
              <>
                {m.tools.length > 0 && (
                  <div className="row" style={{ gap: 6 }}>
                    {m.tools.map((t) => <span key={t.key} className={'tool-chip' + (t.done ? '' : ' running')}>{t.done ? <Icon name="check" size={12} /> : null}{t.done ? t.label : t.label.replace(/^Ran/, 'Running').replace(/^Measured/, 'Measuring').replace(/^Optimised/, 'Optimising').replace(/^Solved/, 'Solving').replace(/^Drew/, 'Drawing').replace(/^Read/, 'Reading').replace(/^Prepared/, 'Preparing')}</span>)}
                  </div>
                )}
                {m.pending && !m.text && <div className="thinking">Thinking <i /><i /><i /></div>}
                {m.text && <div className="bubble"><Markdown text={m.text} /></div>}
                {m.charts.map((c, i) => <SpecChart key={i} spec={c} height={220} onPin={() => pin(m, i)} pinned={m.pinnedIdx?.includes(i)} />)}
                {m.staged && m.staged.length > 0 && (
                  <div className="card tint" style={{ padding: 10 }}>
                    <div className="small strong" style={{ marginBottom: 6 }}>{m.stagedDone ? 'Added to your portfolio' : 'Review before adding'}</div>
                    <div className="table-wrap">
                      <table className="t compact">
                        <tbody>
                          {m.staged.map((r, i) => (
                            <tr key={r.h.id}>
                              <td><input type="checkbox" aria-label={`Include ${r.h.name}`} disabled={m.stagedDone} checked={r.on} onChange={(e) => patch(m.id, (x) => ({ ...x, staged: x.staged!.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)) }))} /></td>
                              <td><div className="cell-name"><span className="n1">{r.h.ticker ? `${r.h.ticker} · ` : ''}{r.h.name}</span><span className="n2">{TYPE_META[r.h.type].label} · {fmtQty(r.h.qty)} {r.h.unit}</span></div></td>
                              <td className="num">{r.h.price ? fmt.money(valuePKR(r.h, ws.market)) : <span style={{ color: 'var(--warn-ink)' }}>price missing</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!m.stagedDone && <div className="row" style={{ marginTop: 8 }}><Button size="sm" variant="primary" icon="plus" onClick={() => addStaged(m)}>Add {m.staged.filter((x) => x.on).length} to portfolio</Button></div>}
                  </div>
                )}
                {m.error && <div className="callout warn"><Icon name="alert" /><div>{m.error}</div></div>}
                {!m.pending && (m.text || m.model) && (
                  <div className="meta">
                    {m.model && <span>{m.model}</span>}
                    {m.text && <button type="button" className="linkbtn tiny" onClick={async () => toast((await copyText(m.text)) ? 'Copied' : 'Copy not available here')}>Copy</button>}
                    {m.kind === 'review' && <button type="button" className="linkbtn tiny" onClick={() => { setAiOpen(false); go('insights'); }}>Saved to AI insights</button>}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="ai-foot">
        {quickAdd && (
          <div className="callout info"><Icon name="plus" /><div>Describe what to add, for example “500 HUBC at 150, 10 tola 22k gold, BSC 25 lakh at 12.72%”. Nothing is added until you confirm. <button type="button" className="linkbtn small" onClick={() => setQuickAdd(false)}>Cancel</button></div></div>
        )}
        <div className="ai-input">
          <textarea
            ref={taRef}
            aria-label="Ask the AI analyst"
            placeholder={avail === 'yes' ? (quickAdd ? 'Holdings to add…' : 'Ask about your portfolio…') : 'AI is not available here'}
            value={input}
            disabled={avail !== 'yes'}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = Math.min(160, el.scrollHeight) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {busy ? (
            <Button iconOnly icon="stop" onClick={() => ctl.current?.abort()}>Stop</Button>
          ) : (
            <Button variant="primary" iconOnly icon="send" onClick={submit} disabled={!input.trim() || avail !== 'yes'}>Send</Button>
          )}
        </div>
        <div className="tiny muted">Educational analysis, not investment advice. {__WEB__ ? 'Each question counts toward your monthly allowance.' : 'Uses your Claude usage.'}</div>
      </div>
    </aside>
  );
}
