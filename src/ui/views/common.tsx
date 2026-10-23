import React from 'react';
import { CLASS_META } from '../../engine/catalog';
import { EXAMPLE_BUILDERS, emptyPortfolio } from '../../engine/samples';
import type { AssetClass } from '../../engine/types';
import { useUI, useWS } from '../../state/store';
import { classColor, useColors } from '../charts/base';
import { Icon } from '../components/Icon';
import { Button } from '../components/primitives';

export function PageHead({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function useClassColor(): (c: AssetClass) => string {
  const colors = useColors();
  return (c: AssetClass) => classColor(colors, CLASS_META[c].slot);
}

export function ExampleBanner() {
  const { active, update } = useWS();
  const { go, toast } = useUI();
  if (!active.isExample) return null;
  return (
    <div className="callout warn" role="note">
      <Icon name="info" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>You are looking at an example portfolio.</strong> Prices are illustrative, not market quotes. Market data, rates and taxes are real and dated.
        <div className="row" style={{ marginTop: 8 }}>
          <Button size="sm" variant="primary" icon="plus" onClick={() => {
            const p = emptyPortfolio('My portfolio');
            update((w) => ({ ...w, portfolios: [...w.portfolios, p], activeId: p.id }));
            toast('Empty portfolio created');
            go('holdings');
          }}>Start my own portfolio</Button>
          <span className="small muted">Other examples: {EXAMPLE_BUILDERS.map((e) => e.label).join(', ')} (portfolio menu at the top)</span>
        </div>
      </div>
    </div>
  );
}

export function Sources({ items }: { items: { label: string; url: string; asOf?: string }[] }) {
  return (
    <div className="sources">
      <span>Sources:</span>
      {items.map((s) => (
        <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
          {s.label}{s.asOf ? ` (${s.asOf})` : ''}
        </a>
      ))}
    </div>
  );
}

export function yearLabels(points: number[], startYear: number): string[] {
  return points.map((m) => String(startYear + Math.round(m / 12)));
}

export function currentYear(): number {
  return new Date().getFullYear();
}
