import React, { useEffect, useRef, useState } from 'react';
import type { ChartColors } from '../../state/store';
import { useColors } from '../../state/store';
import { Icon } from '../components/Icon';

type EC = {
  init: (el: HTMLElement, theme?: unknown, opts?: Record<string, unknown>) => ECInstance;
};
type ECInstance = {
  setOption: (o: unknown, opts?: Record<string, unknown>) => void;
  resize: () => void;
  dispose: () => void;
  on: (ev: string, fn: (p: unknown) => void) => void;
  off: (ev: string) => void;
  getDataURL?: (o: Record<string, unknown>) => string;
};

export function getEcharts(): EC | null {
  return (window as unknown as { echarts?: EC }).echarts ?? null;
}

export interface EChartProps {
  option: Record<string, unknown>;
  height?: number;
  ariaLabel: string;
  dim?: boolean;
  onClick?: (p: { name?: string; seriesName?: string; dataIndex?: number; data?: unknown }) => void;
  instRef?: React.MutableRefObject<ECInstance | null>;
}

export function EChart({ option, height = 300, ariaLabel, dim, onClick, instRef }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<ECInstance | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const ec = getEcharts();
    if (!ec || !ref.current) {
      setMissing(true);
      return;
    }
    const i = ec.init(ref.current, undefined, { renderer: 'canvas' });
    inst.current = i;
    if (instRef) instRef.current = i;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => i.resize());
    });
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      i.dispose();
      inst.current = null;
      if (instRef) instRef.current = null;
    };
  }, []);
  useEffect(() => {
    try {
      inst.current?.setOption(option, { notMerge: true, lazyUpdate: false });
    } catch (e) {
      console.warn('chart option error', e);
    }
  }, [option]);
  useEffect(() => {
    const i = inst.current;
    if (!i || !onClick) return;
    i.on('click', onClick as (p: unknown) => void);
    return () => i.off('click');
  }, [onClick]);
  if (missing)
    return (
      <div className="empty" style={{ height }}>
        <Icon name="chart" />
        <div className="small">Charts need the charting library, which did not load. Check your connection and reload.</div>
      </div>
    );
  return <div ref={ref} className={'chart' + (dim ? ' dim' : '')} style={{ height }} role="img" aria-label={ariaLabel} />;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface TipRow {
  key: string;
  value: string;
  color?: string;
  kind?: 'line' | 'box';
}

export function tipHTML(title: string, rows: TipRow[]): string {
  return (
    `<div class="ec-tip"><div class="tt">${esc(title)}</div>` +
    rows
      .map(
        (r) =>
          `<div class="tr"><span class="k">${r.color ? `<span class="${r.kind === 'box' ? 'sw' : 'lk'}" style="background:${r.color}"></span>` : ''}${esc(r.key)}</span><span class="v">${esc(r.value)}</span></div>`,
      )
      .join('') +
    '</div>'
  );
}

export function axisStyle(c: ChartColors) {
  return {
    axisLine: { lineStyle: { color: c.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: c.text, fontSize: 11, fontFamily: c.font, hideOverlap: true },
    splitLine: { show: true, lineStyle: { color: c.grid, width: 1, type: 'solid' } },
    nameTextStyle: { color: c.text, fontSize: 11, fontFamily: c.font },
  };
}

export function tooltipBase(c: ChartColors, trigger: 'axis' | 'item' = 'axis') {
  return {
    trigger,
    confine: true,
    backgroundColor: c.surface,
    borderColor: c.line,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: c.ink, fontFamily: c.font, fontSize: 12 },
    extraCssText: 'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);',
    axisPointer: { type: 'line', lineStyle: { color: c.axis, width: 1 }, label: { show: false } },
  };
}

export function baseOption(c: ChartColors) {
  return {
    animationDuration: 300,
    animationDurationUpdate: 250,
    textStyle: { fontFamily: c.font, color: c.text },
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
  };
}

/** Hex color with alpha. */
export function alpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function classColor(c: ChartColors, slot: number): string {
  return slot >= 1 && slot <= 8 ? c.series[slot - 1] : c.other;
}

/** A chart card body with an optional table-view twin. */
export function ChartFrame({ chart, table, legend, height, note }: { chart: React.ReactNode; table?: () => React.ReactNode; legend?: React.ReactNode; height?: number; note?: React.ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row-between" style={{ minHeight: 24 }}>
        <div className="chart-legend">{legend}</div>
        {table && (
          <button type="button" className="linkbtn small" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>
      {showTable && table ? <div className="table-wrap" style={{ maxHeight: height ? height + 40 : 360 }}>{table()}</div> : chart}
      {note && <div className="mini-help">{note}</div>}
    </div>
  );
}

export function LegendItem({ color, label, kind = 'box' }: { color: string; label: React.ReactNode; kind?: 'box' | 'line' }) {
  return (
    <span>
      <i className={kind === 'line' ? 'lkey' : 'swatch'} style={{ background: color }} />
      {label}
    </span>
  );
}

export { useColors };
