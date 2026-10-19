/** Geometry for the SVG Sparkline and BarChart (no chart library). */

export interface Box {
  width: number;
  height: number;
  /** Inner padding so strokes are not clipped. */
  pad?: number;
}

const extent = (values: readonly number[]): [number, number] => {
  const lo = Math.min(0, ...values);
  const hi = Math.max(...values);
  return [lo, hi === lo ? lo + 1 : hi];
};

const r = (n: number) => Math.round(n * 100) / 100;

/** SVG points for a polyline; empty string for no data. A single value draws a flat line. */
export function sparkPoints(values: readonly number[], { width, height, pad = 2 }: Box): string {
  if (values.length === 0) return '';
  const series = values.length === 1 ? [values[0]!, values[0]!] : values;
  const [lo, hi] = extent(series);
  const dx = (width - pad * 2) / (series.length - 1);
  return series.map((v, i) => `${r(pad + i * dx)},${r(height - pad - ((v - lo) / (hi - lo)) * (height - pad * 2))}`).join(' ');
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bars from a zero baseline, `gap` as a fraction of each slot. */
export function barRects(values: readonly number[], { width, height, pad = 0 }: Box, gap = 0.2): Bar[] {
  if (values.length === 0) return [];
  const hi = Math.max(1, ...values.map((v) => Math.max(0, v)));
  const slot = (width - pad * 2) / values.length;
  const w = slot * (1 - gap);
  return values.map((v, i) => {
    const h = (Math.max(0, v) / hi) * (height - pad * 2);
    return { x: r(pad + i * slot + (slot - w) / 2), y: r(height - pad - h), width: r(w), height: r(h) };
  });
}
