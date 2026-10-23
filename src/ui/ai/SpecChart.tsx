import React, { useMemo } from 'react';
import { axisMoney, fmtMoney } from '../../engine/format';
import type { ChartSpec } from '../../engine/types';
import { useWS } from '../../state/store';
import { axisStyle, baseOption, ChartFrame, EChart, LegendItem, tipHTML, tooltipBase, useColors } from '../charts/base';
import { BandLineChart, MultiLineChart, StackedBars } from '../charts/charts';
import { Button } from '../components/primitives';

const TYPES: ChartSpec['type'][] = ['line', 'bar', 'stacked_bar', 'area', 'scatter', 'heatmap', 'fan', 'hbar'];

/** Validate and clean a chart spec that came from the AI. Returns null if unusable. */
export function sanitizeSpec(raw: unknown): ChartSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = TYPES.includes(r.type as ChartSpec['type']) ? (r.type as ChartSpec['type']) : 'line';
  const title = String(r.title ?? 'Chart').slice(0, 120);
  const xr = (r.x ?? {}) as Record<string, unknown>;
  const yr = (r.y ?? {}) as Record<string, unknown>;
  const cats = Array.isArray(xr.categories) ? (xr.categories as unknown[]).slice(0, 120).map((c) => (typeof c === 'number' ? c : String(c).slice(0, 40))) : undefined;
  const unit = ['PKR', 'USD', '%', 'number'].includes(String(yr.unit)) ? (yr.unit as 'PKR' | 'USD' | '%' | 'number') : 'number';
  const seriesRaw = Array.isArray(r.series) ? (r.series as unknown[]) : [];
  const series = seriesRaw.slice(0, 8).map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const data = (Array.isArray(o.data) ? (o.data as unknown[]) : []).slice(0, 120).map((d) => {
      if (Array.isArray(d) && d.length >= 2 && isFinite(Number(d[0])) && isFinite(Number(d[1]))) return [Number(d[0]), Number(d[1])] as [number, number];
      const n = Number(d);
      return d === null || d === undefined || !isFinite(n) ? null : n;
    });
    return { name: String(o.name ?? 'Series').slice(0, 60), data };
  }).filter((s) => s.data.some((d) => d !== null));
  let heat: ChartSpec['heat'];
  if (type === 'heatmap' && r.heat && typeof r.heat === 'object') {
    const h = r.heat as Record<string, unknown>;
    const rows = Array.isArray(h.rows) ? (h.rows as unknown[]).slice(0, 20).map(String) : [];
    const cols = Array.isArray(h.cols) ? (h.cols as unknown[]).slice(0, 20).map(String) : [];
    const values = Array.isArray(h.values) ? (h.values as unknown[][]).slice(0, rows.length).map((row) => (Array.isArray(row) ? row.slice(0, cols.length).map((v) => Number(v) || 0) : [])) : [];
    if (rows.length && cols.length) heat = { rows, cols, values };
  }
  if (!series.length && !heat) return null;
  return {
    type, title,
    subtitle: r.subtitle ? String(r.subtitle).slice(0, 160) : undefined,
    x: { label: xr.label ? String(xr.label).slice(0, 40) : undefined, categories: cats },
    y: { label: yr.label ? String(yr.label).slice(0, 40) : undefined, unit },
    series, heat,
    note: r.note ? String(r.note).slice(0, 240) : undefined,
  };
}

export function SpecChart({ spec, height = 260, onPin, pinned }: { spec: ChartSpec; height?: number; onPin?: () => void; pinned?: boolean }) {
  const c = useColors();
  const { ws } = useWS();
  const style = ws.settings.numberStyle;
  const unit = spec.y?.unit ?? 'number';
  const fmtVal = useMemo(() => (v: number) => {
    if (!isFinite(v)) return '–';
    if (unit === 'PKR') return fmtMoney(v, { currency: 'PKR', style, compact: true });
    if (unit === 'USD') return fmtMoney(v, { currency: 'USD', compact: true });
    if (unit === '%') return `${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
    return Math.abs(v) >= 1e4 ? axisMoney(v, 'USD', 'intl').replace('$', '') : String(Math.round(v * 100) / 100);
  }, [unit, style]);
  const fmtAxis = useMemo(() => (v: number) => {
    if (unit === 'PKR') return axisMoney(v, 'PKR', style);
    if (unit === 'USD') return axisMoney(v, 'USD', style);
    if (unit === '%') return `${v}%`;
    return Math.abs(v) >= 1e4 ? axisMoney(v, 'USD', 'intl').replace('$', '') : String(v);
  }, [unit, style]);
  const n = Math.max(0, ...spec.series.map((s) => s.data.length));
  const labels = (spec.x?.categories && spec.x.categories.length ? spec.x.categories : Array.from({ length: n }, (_, i) => i + 1)).map(String);
  const colors = spec.series.map((_, i) => c.series[i % 8]);
  const num = (arr: (number | null | [number, number])[]) => arr.map((d) => (Array.isArray(d) ? d[1] : d ?? 0)) as number[];

  let chart: React.ReactNode;
  if (spec.type === 'fan' && spec.series.length >= 3) {
    const find = (re: RegExp, i: number) => spec.series.find((s) => re.test(s.name)) ?? spec.series[i];
    const lo = find(/p?10|low|worst|pess/i, 0), mid = find(/p?50|median|base|mid/i, 1), hi = find(/p?90|high|best|opt/i, 2);
    chart = <BandLineChart labels={labels} median={num(mid.data)} low={num(lo.data)} high={num(hi.data)} fmtVal={fmtVal} fmtAxis={fmtAxis} name={mid.name} height={height} ariaLabel={spec.title} />;
  } else if (spec.type === 'bar' || spec.type === 'stacked_bar' || spec.type === 'hbar') {
    chart = <StackedBars labels={labels} series={spec.series.map((s, i) => ({ name: s.name, data: num(s.data), color: colors[i] }))} fmtVal={fmtVal} fmtAxis={fmtAxis} height={height} ariaLabel={spec.title} stacked={spec.type === 'stacked_bar'} horizontal={spec.type === 'hbar'} />;
  } else if (spec.type === 'scatter') {
    chart = <ScatterSpec spec={spec} height={height} fmtVal={fmtVal} />;
  } else if (spec.type === 'heatmap' && spec.heat) {
    chart = <HeatSpec heat={spec.heat} height={height} title={spec.title} fmtVal={fmtVal} />;
  } else {
    chart = <MultiLineChart labels={labels} series={spec.series.map((s, i) => ({ name: s.name, data: s.data.map((d) => (Array.isArray(d) ? d[1] : d)), color: colors[i] }))} fmtVal={fmtVal} fmtAxis={fmtAxis} height={height} ariaLabel={spec.title} endLabels={spec.series.length <= 4} />;
  }
  return (
    <div className="ai-chart">
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="strong" style={{ fontSize: 13.5 }}>{spec.title}</div>
          {spec.subtitle && <div className="small muted">{spec.subtitle}</div>}
        </div>
        {onPin && <Button size="sm" variant="ghost" icon="pin" disabled={pinned} onClick={onPin}>{pinned ? 'Pinned' : 'Pin'}</Button>}
      </div>
      <ChartFrame
        legend={spec.series.length > 1 && spec.type !== 'fan' ? spec.series.map((s, i) => <LegendItem key={s.name + i} color={colors[i]} kind={spec.type === 'line' || spec.type === 'area' ? 'line' : 'box'} label={s.name} />) : null}
        chart={chart}
        table={() => (
          <table className="t compact">
            <thead><tr><th>{spec.x?.label ?? ''}</th>{spec.series.map((s, i) => <th key={i} className="num">{s.name}</th>)}</tr></thead>
            <tbody>{labels.map((l, i) => <tr key={l + i}><td>{l}</td>{spec.series.map((s, j) => { const d = s.data[i]; const v = Array.isArray(d) ? d[1] : d; return <td key={j} className="num">{v === null || v === undefined ? '–' : fmtVal(v)}</td>; })}</tr>)}</tbody>
          </table>
        )}
      />
      {spec.note && <div className="mini-help" style={{ marginBottom: 6 }}>{spec.note}</div>}
    </div>
  );
}

function ScatterSpec({ spec, height, fmtVal }: { spec: ChartSpec; height: number; fmtVal: (v: number) => string }) {
  const c = useColors();
  const option = useMemo(() => ({
    ...baseOption(c),
    tooltip: { ...tooltipBase(c, 'item'), formatter: (p: { seriesName: string; value: [number, number] }) => tipHTML(p.seriesName, [{ key: spec.x?.label ?? 'x', value: String(Math.round(p.value[0] * 100) / 100) }, { key: spec.y?.label ?? 'y', value: fmtVal(p.value[1]) }]) },
    xAxis: { type: 'value', name: spec.x?.label, nameLocation: 'middle', nameGap: 24, scale: true, ...axisStyle(c) },
    yAxis: { type: 'value', name: spec.y?.label, scale: true, ...axisStyle(c), axisLine: { show: false } },
    series: spec.series.slice(0, 3).map((s, i) => ({ name: s.name, type: 'scatter', symbolSize: 9, data: s.data.filter((d) => Array.isArray(d)), itemStyle: { color: c.series[i], borderColor: c.surface, borderWidth: 2 } })),
  }), [spec, c, fmtVal]);
  return <EChart option={option} height={height} ariaLabel={spec.title} />;
}

function HeatSpec({ heat, height, title, fmtVal }: { heat: NonNullable<ChartSpec['heat']>; height: number; title: string; fmtVal: (v: number) => string }) {
  const c = useColors();
  const option = useMemo(() => {
    const data: [number, number, number][] = [];
    heat.values.forEach((row, i) => row.forEach((v, j) => data.push([j, i, v])));
    const vals = data.map((d) => d[2]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const diverging = lo < 0 && hi > 0;
    return {
      ...baseOption(c),
      grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
      tooltip: { ...tooltipBase(c, 'item'), formatter: (p: { value: [number, number, number] }) => tipHTML(`${heat.rows[p.value[1]]} · ${heat.cols[p.value[0]]}`, [{ key: 'Value', value: fmtVal(p.value[2]) }]) },
      xAxis: { type: 'category', data: heat.cols, ...axisStyle(c), splitLine: { show: false } },
      yAxis: { type: 'category', data: heat.rows, inverse: true, ...axisStyle(c), splitLine: { show: false } },
      visualMap: { min: diverging ? -Math.max(-lo, hi) : lo, max: diverging ? Math.max(-lo, hi) : hi, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 140, itemWidth: 12, textStyle: { color: c.text, fontSize: 11 }, inRange: { color: diverging ? [c.critical, c.dark ? '#383835' : '#f0efec', c.series[0]] : [c.dark ? '#1c5cab' : '#cde2fb', c.series[0], c.dark ? '#cde2fb' : '#0d366b'] } },
      series: [{ type: 'heatmap', data, label: { show: heat.cols.length <= 8, fontSize: 11, color: c.ink, formatter: (p: { value: [number, number, number] }) => fmtVal(p.value[2]) }, itemStyle: { borderColor: c.surface, borderWidth: 2 } }],
    };
  }, [heat, c, fmtVal]);
  return <EChart option={option} height={height} ariaLabel={title} />;
}
