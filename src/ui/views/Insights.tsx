import React, { useEffect, useState } from 'react';
import { fmtDate } from '../../engine/format';
import { useUI, useWS } from '../../state/store';
import { getSample } from '../ai/client';
import { Markdown } from '../ai/Markdown';
import { SpecChart } from '../ai/SpecChart';
import { Icon } from '../components/Icon';
import { Button, Callout, Card, Empty, copyText } from '../components/primitives';
import { PageHead } from './common';

const IDEAS = [
  'Chart my passive income by source for the next 10 years',
  'How exposed am I to a 30% rupee devaluation, in dollars?',
  'Draw my net worth range in today’s money until I turn 60',
  'Compare my mix with the Balanced model portfolio, with a chart',
  'Which three changes would most improve my goal odds?',
  'Show a heatmap of how my asset classes move together',
];

export function Insights() {
  const { active, updatePortfolio } = useWS();
  const { askAI, toast } = useUI();
  const [avail, setAvail] = useState<boolean | null>(null);
  useEffect(() => {
    getSample().then((s) => setAvail(!!s));
  }, []);
  const review = active.lastReview;
  const pinned = [...active.pinned].reverse();

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="AI insights"
        sub={`Reviews and charts from the AI analyst, kept with this portfolio. The analyst runs on ${__WEB__ ? 'Claude' : 'Claude Opus 5.5'} and uses the same engine as every screen.`}
        actions={<>
          <Button variant="ai" icon="sparkle" onClick={() => askAI('__review__')} disabled={avail === false}>{review ? 'Run a fresh review' : 'Review my portfolio'}</Button>
        </>}
      />
      {avail === false && (
        <Callout>{__WEB__ ? 'Sign in to use the AI analyst. Saved reviews and charts still show here.' : 'The AI analyst works when this page is opened in Claude, using your own Claude account. Saved reviews and charts still show here.'}</Callout>
      )}
      <Card title="Latest portfolio review" sub={review ? `${fmtDate(review.at.slice(0, 10))}${review.model ? ` · ${review.model}` : ''}` : undefined}
        actions={review ? <>
          <Button size="sm" variant="ghost" icon="copy" onClick={async () => toast((await copyText(review.text)) ? 'Review copied' : 'Copy is not available here')}>Copy</Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => updatePortfolio((p) => ({ ...p, lastReview: undefined }))}>Remove</Button>
        </> : undefined}>
        {review ? (
          <div className="stack">
            <Markdown text={review.text} />
            <p className="mini-help">Written from the holdings, prices and assumptions on {fmtDate(review.at.slice(0, 10))}. Run a fresh review after big changes. Educational analysis, not investment advice.</p>
          </div>
        ) : (
          <Empty icon="insights" title="No review yet" action={<Button variant="ai" icon="sparkle" disabled={avail === false} onClick={() => askAI('__review__')}>Review my portfolio</Button>}>
            The analyst runs a forecast, a risk report and a stress test, then writes a verdict with strengths, weaknesses, a goals check and actions to consider.
          </Empty>
        )}
      </Card>

      <div className="row-between">
        <h2 className="card-title" style={{ fontSize: 16 }}>Pinned charts</h2>
        <span className="small muted">{pinned.length ? `${pinned.length} saved` : 'Pin any chart the analyst draws'}</span>
      </div>
      {pinned.length ? (
        <div className="grid">
          {pinned.map((p) => (
            <section key={p.id} className="card span-6">
              <div className="card-b stack" style={{ paddingTop: 12 }}>
                <SpecChart spec={p.spec} height={260} />
                <div className="row-between">
                  <span className="tiny muted">{p.prompt ? `“${p.prompt.slice(0, 90)}${p.prompt.length > 90 ? '…' : ''}” · ` : ''}pinned {fmtDate(p.createdAt)}</span>
                  <div className="row" style={{ gap: 4 }}>
                    <Button size="sm" variant="ghost" icon="refresh" disabled={avail === false} onClick={() => askAI(`${p.prompt ? p.prompt + '\n\n' : ''}Redraw the chart "${p.title}" with today's data from the tools, then note in one or two sentences what changed.`, true, `Refresh: ${p.title}`)}>Refresh</Button>
                    <Button size="sm" variant="ghost" iconOnly icon="trash" onClick={() => { updatePortfolio((x) => ({ ...x, pinned: x.pinned.filter((y) => y.id !== p.id) })); toast('Chart removed'); }}>Remove {p.title}</Button>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card>
          <div className="stack">
            <p className="small ink2">Ask the analyst for a chart, then press Pin on it to keep it here and on the Overview. Some ideas:</p>
            <div className="prompt-chips">
              {IDEAS.map((q) => <button key={q} type="button" disabled={avail === false} onClick={() => askAI(q, true)}><Icon name="sparkle" size={12} /> {q}</button>)}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
