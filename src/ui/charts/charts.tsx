import React, { useMemo } from 'react';
import { alpha, axisStyle, baseOption, EChart, esc, tipHTML, tooltipBase, useColors } from './base';

type Fmt = (v: number) => string;

// ---------------- Fan chart ----------------

export interface FanGoal {
  index: number;
  value: number;
  name: string;
  prob?: number;
}

export function FanChart({ labels, pct, contrib, goals, fmtVal, fmtAxis, height = 340, dim, ariaLabel, sample }: {
  labels: string[]; pct: number[][]; contrib?: number[]; goals?: FanGoal[]; fmtVal: Fmt; fmtAxis: Fmt; height?: number; dim?: boolean; ariaLabel: string;
  sample?: number[][];
}) {
  const c = useColors();
  const option = useMemo(() => {
    // Outer band is P10 to P90 so the picture matches the headline "1 in 10" figures.
    const [, p10, p25, p50, p75, p90] = pct;
    const blue = c.series[0];
    const series: Record<string, unknown>[] = [
      { name: 'p10', type: 'line', data: p10, stack: 'outer', lineStyle: { opacity: 0 }, symbol: 'none', silent: true, z: 1 },
      { name: 'P10 to P90', type: 'line', data: p90.map((v, i) => v - p10[i]), stack: 'outer', lineStyle: { opacity: 0 }, symbol: 'none', areaStyle: { color: alpha(blue, c.dark ? 0.16 : 0.11) }, silent: true, z: 1 },
      { name: 'p25', type: 'line', data: p25, stack: 'inner', lineStyle: { opacity: 0 }, symbol: 'none', silent: true, z: 2 },
      { name: 'P25 to P75', type: 'line', data: p75.map((v, i) => v - p25[i]), stack: 'inner', lineStyle: { opacity: 0 }, symbol: 'none', areaStyle: { color: alpha(blue, c.dark ? 0.3 : 0.22) }, silent: true, z: 2 },
      {
        name: 'Median', type: 'line', data: p50, symbol: 'circle', symbolSize: 7, showSymbol: false, lineStyle: { width: 2, color: blue }, itemStyle: { color: blue, borderColor: c.surface, borderWidth: 2 }, z: 4,
        endLabel: { show: true, formatter: (p: { value: number }) => fmtAxis(p.value), color: c.ink, fontSize: 11.5, fontWeight: 600, fontFamily: c.font, distance: 6 },
      },
    ];
    if (sample?.length)
      sample.forEach((s, i) => series.push({ name: `path${i}`, type: 'line', data: s, symbol: 'none', silent: true, lineStyle: { width: 1, color: alpha(c.ink3, 0.28) }, z: 3 }));
    if (contrib)
      series.push({ name: 'Money put in', type: 'line', data: contrib, symbol: 'none', lineStyle: { width: 1.5, color: c.other }, z: 3 });
    if (goals?.length)
      series.push({
        name: 'Goals', type: 'scatter', z: 5, symbol: 'diamond', symbolSize: 12,
        // A goal on the last point would collide with the median's end label, so label it to the left.
        data: goals.map((g) => ({ value: [g.index, g.value], name: g.name, label: g.index >= labels.length - 2 ? { position: 'left' } : undefined })),
        itemStyle: { color: c.ink, borderColor: c.surface, borderWidth: 2 },
        label: { show: true, position: 'top', distance: 6, formatter: (p: { name: string }) => p.name, color: c.ink2, fontSize: 11, fontFamily: c.font, backgroundColor: alpha(c.surface, 0.85), padding: [1, 3], borderRadius: 3 },
        labelLayout: { hideOverlap: true },
        tooltip: { trigger: 'item', formatter: (p: { name: string; value: [number, number] }) => tipHTML(p.name, [{ key: 'Target', value: fmtVal(p.value[1]) }, ...(goals.find((g) => g.name === p.name)?.prob !== undefined ? [{ key: 'Chance funded', value: `${Math.round((goals.find((g) => g.name === p.name)!.prob ?? 0) * 100)}%` }] : [])]) },
      });
    return {
      ...baseOption(c),
      grid: { left: 8, right: 64, top: 24, bottom: 8, containLabel: true },
      tooltip: {
        ...tooltipBase(c),
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0;
          const rows = [
            { key: 'Optimistic (P90)', value: fmtVal(p90[i]), color: alpha(blue, 0.35), kind: 'box' as const },
            { key: 'Upper (P75)', value: fmtVal(p75[i]), color: alpha(blue, 0.6), kind: 'box' as const },
            { key: 'Median', value: fmtVal(p50[i]), color: blue, kind: 'line' as const },
            { key: 'Lower (P25)', value: fmtVal(p25[i]), color: alpha(blue, 0.6), kind: 'box' as const },
            { key: 'Pessimistic (P10)', value: fmtVal(p10[i]), color: alpha(blue, 0.35), kind: 'box' as const },
          ];
          if (contrib) rows.push({ key: 'Money put in', value: fmtVal(contrib[i]), color: c.other, kind: 'line' as const });
          return tipHTML(labels[i], rows);
        },
      },
      xAxis: { type: 'category', data: labels, boundaryGap: false, ...axisStyle(c), splitLine: { show: false } },
      yAxis: { type: 'value', ...axisStyle(c), axisLabel: { ...axisStyle(c).axisLabel, formatter: fmtAxis }, axisLine: { show: false } },
      series,
    };
  }, [labels, pct, contrib, goals, c, fmtVal, fmtAxis, sample]);
  return <EChart option={option} height={height} ariaLabel={ariaLabel} dim={dim} />;
}

// ---------------- Line with band ----------------

export function BandLineChart({ labels, median, low, high, fmtVal, fmtAxis, color, name, height = 200, ariaLabel, yMin }: {
  labels: string[]; median: number[]; low?: number[]; high?: number[]; fmtVal: Fmt; fmtAxis: Fmt; color?: string; name: string; height?: number; ariaLabel: string; yMin?: number;
}) {
  const c = useColors();
  const option = useMemo(() => {
    const col = color ?? c.series[0];
    const series: Record<string, unknown>[] = [];
    if (low && high) {
      series.push({ name: 'low', type: 'line', data: low, stack: 'b', lineStyle: { opacity: 0 }, symbol: 'none', silent: true });
      series.push({ name: 'band', type: 'line', data: high.map((v, i) => v - low[i]), stack: 'b', lineStyle: { opacity: 0 }, symbol: 'none', silent: true, areaStyle: { color: alpha(col, c.dark ? 0.2 : 0.14) } });
    }
    series.push({ name, type: 'line', data: median, symbol: 'circle', showSymbol: false, symbolSize: 7, lineStyle: { width: 2, color: col }, itemStyle: { color: col, borderColor: c.surface, borderWidth: 2 } });
    return {
      ...baseOption(c),
      tooltip: {
        ...tooltipBase(c),
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0;
          const rows = [{ key: name, value: fmtVal(median[i]), color: col, kind: 'line' as const }];
          if (low && high) rows.push({ key: 'Range (P10 to P90)', value: `${fmtVal(low[i])} to ${fmtVal(high[i])}`, color: alpha(col, 0.4), kind: 'line' as const });
          return tipHTML(labels[i], rows);
        },
      },
      xAxis: { type: 'category', data: labels, boundaryGap: false, ...axisStyle(c), splitLine: { show: false } },
      yAxis: { type: 'value', min: yMin, ...axisStyle(c), axisLine: { show: false }, axisLabel: { ...axisStyle(c).axisLabel, formatter: fmtAxis } },
      series,
    };
  }, [labels, median, low, high, c, color, name, fmtVal, fmtAxis, yMin]);
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}

// ---------------- Multi-line ----------------

export function MultiLineChart({ labels, series, fmtVal, fmtAxis, height = 300, ariaLabel, yName, endLabels = true }: {
  labels: string[]; series: { name: string; data: (number | null)[]; color: string; width?: number }[]; fmtVal: Fmt; fmtAxis: Fmt; height?: number; ariaLabel: string; yName?: string; endLabels?: boolean;
}) {
  const c = useColors();
  const option = useMemo(() => ({
    ...baseOption(c),
    grid: { left: 8, right: endLabels ? 72 : 16, top: 20, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltipBase(c),
      formatter: (ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0;
        return tipHTML(labels[i], series.map((s) => ({ key: s.name, value: s.data[i] === null || s.data[i] === undefined ? '–' : fmtVal(s.data[i] as number), color: s.color, kind: 'line' as const })));
      },
    },
    xAxis: { type: 'category', data: labels, boundaryGap: false, ...axisStyle(c), splitLine: { show: false } },
    yAxis: { type: 'value', name: yName, scale: false, ...axisStyle(c), axisLine: { show: false }, axisLabel: { ...axisStyle(c).axisLabel, formatter: fmtAxis } },
    series: series.map((s) => ({
      name: s.name, type: 'line', data: s.data, symbol: 'circle', showSymbol: false, symbolSize: 7, connectNulls: false,
      lineStyle: { width: s.width ?? 2, color: s.color }, itemStyle: { color: s.color, borderColor: c.surface, borderWidth: 2 },
      endLabel: endLabels ? { show: true, formatter: (p: { value: number }) => fmtAxis(p.value), color: c.ink2, fontSize: 11, fontFamily: c.font } : undefined,
    })),
  }), [labels, series, c, fmtVal, fmtAxis, yName, endLabels]);
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}

// ---------------- Bars ----------------

export function StackedBars({ labels, series, fmtVal, fmtAxis, height = 280, ariaLabel, horizontal, stacked = true, showTotal }: {
  labels: string[]; series: { name: string; data: number[]; color: string }[]; fmtVal: Fmt; fmtAxis: Fmt; height?: number; ariaLabel: string; horizontal?: boolean; stacked?: boolean; showTotal?: boolean;
}) {
  const c = useColors();
  const option = useMemo(() => {
    const cat = { type: 'category', data: labels, ...axisStyle(c), splitLine: { show: false } };
    const val = { type: 'value', ...axisStyle(c), axisLine: { show: false }, axisLabel: { ...axisStyle(c).axisLabel, formatter: fmtAxis } };
    const n = series.length;
    return {
      ...baseOption(c),
      tooltip: {
        ...tooltipBase(c),
        axisPointer: { type: 'shadow', shadowStyle: { color: alpha(c.ink3, 0.08) } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0;
          const rows = series.filter((s) => s.data[i]).map((s) => ({ key: s.name, value: fmtVal(s.data[i]), color: s.color, kind: 'box' as const }));
          if (showTotal || stacked) rows.push({ key: 'Total', value: fmtVal(series.reduce((t, s) => t + (s.data[i] || 0), 0)), color: '', kind: 'box' as const });
          return tipHTML(labels[i], rows);
        },
      },
      xAxis: horizontal ? val : cat,
      yAxis: horizontal ? { ...cat, inverse: true } : val,
      series: series.map((s, si) => ({
        name: s.name,
        type: 'bar',
        stack: stacked ? 'total' : undefined,
        data: s.data,
        barMaxWidth: 24,
        barGap: stacked ? undefined : '18%',
        itemStyle: {
          color: s.color,
          borderColor: c.surface,
          borderWidth: stacked ? 1 : 0,
          borderRadius: stacked ? (si === n - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0) : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
        },
        emphasis: { focus: 'none', itemStyle: { opacity: 0.85 } },
      })),
    };
  }, [labels, series, c, fmtVal, fmtAxis, horizontal, stacked, showTotal]);
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}

export function DivergingBars({ labels, values, fmtVal, fmtAxis, height = 260, ariaLabel }: { labels: string[]; values: number[]; fmtVal: Fmt; fmtAxis: Fmt; height?: number; ariaLabel: string }) {
  const c = useColors();
  const option = useMemo(() => {
    const neg = c.critical;
    const pos = c.series[0];
    return {
      ...baseOption(c),
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        ...tooltipBase(c, 'item'),
        formatter: (p: { dataIndex: number }) => tipHTML(labels[p.dataIndex], [{ key: values[p.dataIndex] < 0 ? 'Loss' : 'Gain', value: fmtVal(values[p.dataIndex]), color: values[p.dataIndex] < 0 ? neg : pos, kind: 'box' }]),
      },
      xAxis: { type: 'value', ...axisStyle(c), axisLine: { show: false }, axisLabel: { ...axisStyle(c).axisLabel, formatter: fmtAxis } },
      yAxis: { type: 'category', data: labels, inverse: true, ...axisStyle(c), splitLine: { show: false }, axisLine: { lineStyle: { color: c.axis } } },
      series: [{
        type: 'bar', data: values.map((v) => ({ value: v, itemStyle: { color: v < 0 ? neg : pos, borderRadius: v < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0] } })), barMaxWidth: 20,
        label: { show: true, position: 'right', formatter: (p: { value: number }) => fmtVal(p.value), color: c.ink2, fontSize: 11, fontFamily: c.font },
      }],
    };
  }, [labels, values, c, fmtVal, fmtAxis]);
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}

export function PairedBars({ labels, a, b, fmtVal, height = 260, ariaLabel }: { labels: string[]; a: { name: string; data: number[]; color: string }; b: { name: string; data: number[]; color: string }; fmtVal: Fmt; height?: number; ariaLabel: string }) {
  const c = useColors();
  const option = useMemo(() => ({
    ...baseOption(c),
    grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltipBase(c),
      axisPointer: { type: 'shadow', shadowStyle: { color: alpha(c.ink3, 0.08) } },
      formatter: (ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0;
        return tipHTML(labels[i], [{ key: a.name, value: fmtVal(a.data[i]), color: a.color, kind: 'box' }, { key: b.name, value: fmtVal(b.data[i]), color: b.color, kind: 'box' }]);
      },
    },
    xAxis: { type: 'value', ...axisStyle(c), axisLine: { show: false }, axisLabel: { ...axisStyle(c).axisLabel, formatter: fmtVal } },
    yAxis: { type: 'category', data: labels, inverse: true, ...axisStyle(c), splitLine: { show: false } },
    series: [a, b].map((s) => ({
      name: s.name, type: 'bar', data: s.data, barMaxWidth: 12, barGap: '25%', itemStyle: { color: s.color, borderRadius: [0, 4, 4, 0] },
    })),
  }), [labels, a, b, c, fmtVal]);
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}

// ---------------- Histogram ----------------

export function Histogram({ edges, counts, fmtVal, markers, height = 240, ariaLabel, color }: {
  edges: number[]; counts: number[]; fmtVal: Fmt; markers?: { value: number; label: string }[]; height?: number; ariaLabel: string; color?: string;
}) {
  const c = useColors();
  const option = useMemo(() => {
    const mids = counts.map((_, i) => (edges[i] + edges[i + 1]) / 2);
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const col = color ?? c.series[0];
    const markIdx = (v: number) => {
      let k = mids.findIndex((m) => m >= v);
      if (k < 0) k = mids.length - 1;
      return k;
    };
    return {
      ...baseOption(c),
      grid: { left: 8, right: 16, top: markers?.length ? 30 : 12, bottom: 8, containLabel: true },
      tooltip: {
        ...tooltipBase(c, 'item'),
        formatter: (p: { dataIndex: number }) => tipHTML(`${fmtVal(edges[p.dataIndex])} to ${fmtVal(edges[p.dataIndex + 1])}`, [{ key: 'Share of outcomes', value: `${((counts[p.dataIndex] / total) * 100).toFixed(1)}%`, color: col, kind: 'box' }]),
      },
      xAxis: { type: 'category', data: mids.map((m) => fmtVal(m)), ...axisStyle(c), splitLine: { show: false }, axisLabel: { ...axisStyle(c).axisLabel, interval: Math.max(0, Math.floor(mids.length / 6) - 1) } },
      yAxis: { type: 'value', ...axisStyle(c), axisLine: { show: false }, axisLabel: { ...axisStyle(c).axisLabel, formatter: (v: number) => `${((v / total) * 100).toFixed(0)}%` } },
      series: [{
        type: 'bar', data: counts, barCategoryGap: '8%', itemStyle: { color: alpha(col, 0.85), borderRadius: [3, 3, 0, 0] },
        markLine: markers?.length ? {
          symbol: 'none', silent: true,
          lineStyle: { color: c.ink2, width: 1, type: 'solid' },
          label: { color: c.ink, fontSize: 11, fontFamily: c.font, formatter: (p: { name: string }) => p.name, position: 'end' },
          data: markers.map((m) => ({ xAxis: markIdx(m.value), name: m.label })),
        } : undefined,
      }],
    };
  }, [edges, counts, c, fmtVal, markers, color]);
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}

// ---------------- Waterfall ----------------

export function Waterfall({ steps, fmtVal, fmtAxis, height = 260, ariaLabel }: { steps: { label: string; value: number; total?: boolean }[]; fmtVal: Fmt; fmtAxis: Fmt; height?: number; ariaLabel: string }) {
  const c = useColors();
  const option = useMemo(() => {
    let run = 0;
    const base: number[] = [];
    const vis: { value: number; itemStyle: Record<string, unknown> }[] = [];
    for (const s of steps) {
      if (s.total) {
        base.push(0);
        vis.push({ value: s.value, itemStyle: { color: c.ink3, borderRadius: [4, 4, 0, 0] } });
        run = s.value;
      } else {
        const start = run;
        run += s.value;
        base.push(Math.min(start, run));
        vis.push({ value: Math.abs(s.value), itemStyle: { color: s.value < 0 ? c.critical : c.series[0], borderRadius: [4, 4, 0, 0] } });
      }
    }
    return {
      ...baseOption(c),
      tooltip: {
        ...tooltipBase(c),
        axisPointer: { type: 'shadow', shadowStyle: { color: alpha(c.ink3, 0.08) } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0;
          const s = steps[i];
          return tipHTML(s.label, [{ key: s.total ? 'Value' : s.value < 0 ? 'Reduces by' : 'Adds', value: fmtVal(Math.abs(s.value)) }]);
        },
      },
      xAxis: { type: 'category', data: steps.map((s) => s.label), ...axisStyle(c), splitLine: { show: false }, axisLabel: { ...axisStyle(c).axisLabel, interval: 0, width: 80, overflow: 'break' } },
      yAxis: { type: 'value', ...axisStyle(c), axisLine: { show: false }, axisLabel: { ...axisStyle(c).axisLabel, formatter: fmtAxis } },
      series: [
        { type: 'bar', stack: 'w', data: base, itemStyle: { color: 'transparent' }, silent: true, barMaxWidth: 40 },
        { type: 'bar', stack: 'w', data: vis, barMaxWidth: 40, label: { show: true, position: 'top', formatter: (p: { dataIndex: number }) => fmtAxis(steps[p.dataIndex].value), color: c.ink2, fontSize: 11, fontFamily: c.font } },
      ],
    };
  }, [steps, c, fmtVal, fmtAxis]);
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}

// ---------------- Heatmap ----------------

export function CorrelationHeatmap({ labels, matrix, height = 300, ariaLabel }: { labels: string[]; matrix: number[][]; height?: number; ariaLabel: string }) {
  const c = useColors();
  const option = useMemo(() => {
    const data: [number, number, number][] = [];
    matrix.forEach((row, i) => row.forEach((v, j) => data.push([j, i, Math.round(v * 100) / 100])));
    const mid = c.dark ? '#383835' : '#f0efec';
    return {
      ...baseOption(c),
      grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
      tooltip: { ...tooltipBase(c, 'item'), formatter: (p: { value: [number, number, number] }) => tipHTML(`${labels[p.value[1]]} and ${labels[p.value[0]]}`, [{ key: 'Correlation', value: p.value[2].toFixed(2) }]) },
      xAxis: { type: 'category', data: labels, ...axisStyle(c), splitLine: { show: false }, axisLabel: { ...axisStyle(c).axisLabel, interval: 0, rotate: labels.length > 5 ? 30 : 0 } },
      yAxis: { type: 'category', data: labels, inverse: true, ...axisStyle(c), splitLine: { show: false } },
      visualMap: { min: -1, max: 1, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemWidth: 12, itemHeight: 140, textStyle: { color: c.text, fontSize: 11 }, inRange: { color: [c.critical, mid, c.series[0]] }, text: ['+1', '-1'] },
      series: [{ type: 'heatmap', data, label: { show: true, color: c.ink, fontSize: 11, fontFamily: c.font, formatter: (p: { value: [number, number, number] }) => p.value[2].toFixed(2) }, itemStyle: { borderColor: c.surface, borderWidth: 2 } }],
    };
  }, [labels, matrix, c]);
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}

// ---------------- Frontier ----------------

export function FrontierChart({ frontier, points, height = 340, ariaLabel }: {
  frontier: { vol: number; ret: number }[]; points: { name: string; vol: number; ret: number; color: string; size?: number; strong?: boolean }[]; height?: number; ariaLabel: string;
}) {
  const c = useColors();
  const option = useMemo(() => ({
    ...baseOption(c),
    grid: { left: 8, right: 24, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltipBase(c, 'item'),
      formatter: (p: { seriesName: string; data: { name?: string; value: [number, number] } | [number, number] }) => {
        const d = Array.isArray(p.data) ? { name: 'Efficient frontier', value: p.data } : p.data;
        return tipHTML(d.name ?? p.seriesName, [{ key: 'Expected return', value: `${d.value[1].toFixed(1)}%` }, { key: 'Volatility', value: `${d.value[0].toFixed(1)}%` }]);
      },
    },
    xAxis: { type: 'value', name: 'Volatility, 1 year (%)', nameLocation: 'middle', nameGap: 26, scale: true, ...axisStyle(c), axisLabel: { ...axisStyle(c).axisLabel, formatter: (v: number) => `${v}%` } },
    yAxis: { type: 'value', name: 'Expected return (%)', scale: true, ...axisStyle(c), nameTextStyle: { ...axisStyle(c).nameTextStyle, align: 'left' }, axisLine: { show: false }, axisLabel: { ...axisStyle(c).axisLabel, formatter: (v: number) => `${v}%` } },
    series: [
      { name: 'Efficient frontier', type: 'line', data: frontier.map((f) => [f.vol * 100, f.ret * 100]), symbol: 'none', smooth: true, lineStyle: { width: 2, color: c.series[0] }, z: 2 },
      ...points.map((p) => ({
        name: p.name, type: 'scatter', z: 3, symbolSize: p.size ?? 11,
        data: [{ name: p.name, value: [p.vol * 100, p.ret * 100] }],
        itemStyle: { color: p.color, borderColor: c.surface, borderWidth: 2 },
        label: { show: true, position: 'right', formatter: p.name, color: p.strong ? c.ink : c.ink2, fontWeight: p.strong ? 600 : 400, fontSize: 11, fontFamily: c.font },
      })),
    ],
  }), [frontier, points, c]);
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}

// ---------------- Treemap ----------------

export function Treemap({ data, fmtVal, height = 320, ariaLabel }: { data: { name: string; value: number; color: string; children: { name: string; value: number }[] }[]; fmtVal: Fmt; height?: number; ariaLabel: string }) {
  const c = useColors();
  const option = useMemo(() => {
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    return {
      ...baseOption(c),
      tooltip: { ...tooltipBase(c, 'item'), formatter: (p: { name: string; value: number; treePathInfo: { name: string }[] }) => tipHTML(p.treePathInfo.map((t) => t.name).filter(Boolean).join(' › '), [{ key: 'Value', value: fmtVal(p.value) }, { key: 'Share', value: `${((p.value / total) * 100).toFixed(1)}%` }]) },
      series: [{
        type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false }, width: '100%', height: '100%', top: 0, left: 0,
        itemStyle: { borderColor: c.surface, borderWidth: 2, gapWidth: 2 },
        levels: [{ itemStyle: { borderColor: c.surface, borderWidth: 3, gapWidth: 3 } }, { itemStyle: { borderColor: c.surface, borderWidth: 1.5, gapWidth: 1.5 } }],
        label: { show: true, formatter: (p: { name: string; value: number }) => `${p.name}\n${fmtVal(p.value)}`, fontSize: 11, fontFamily: c.font, overflow: 'truncate' },
        upperLabel: { show: false },
        data: data.map((d) => ({
          name: d.name, value: d.value, itemStyle: { color: d.color }, label: { color: labelOn(d.color) },
          children: d.children.map((ch, i) => {
            const a = 1 - Math.min(0.45, i * 0.06);
            // Tiny tiles cannot hold a readable label; the tooltip still names them.
            return { name: ch.name, value: ch.value, itemStyle: { color: alpha(d.color, a) }, label: { show: ch.value / total >= 0.02, color: labelOn(d.color, a, c.surface) } };
          }),
        })),
      }],
    };
  }, [data, c, fmtVal]);
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}

/** Ink or white label for text set inside a colored fill (optionally blended over the surface). */
export function labelOn(hex: string, a = 1, surface = '#ffffff'): string {
  const parse = (h: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
    const n = m ? parseInt(m[1], 16) : 0x888888;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = parse(hex);
  const [r2, g2, b2] = parse(surface);
  const mix = (x: number, y: number) => (x * a + y * (1 - a)) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(mix(r1, r2)) + 0.7152 * lin(mix(g1, g2)) + 0.0722 * lin(mix(b1, b2));
  // Crossover where dark ink and white give equal contrast is about L = 0.18.
  return L > 0.2 ? '#0C1322' : '#FFFFFF';
}

export { esc };
