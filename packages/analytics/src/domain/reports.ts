import type { TrackEventName } from '@ecomkit/core/contracts';
import { z } from 'zod';

/** Reports this module computes. Sales, products and customers come from other modules through the `reports` extension point. */
export const REPORT_NAMES = ['overview', 'funnel', 'traffic', 'journeys', 'search', 'wizard', 'attention', 'bots', 'vitals'] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const dateRangeSchema = z
  .object({ from: isoDay, to: isoDay })
  .refine((r) => r.from <= r.to, { message: 'from must not be after to' });

/** The purchase funnel, in order. A session counts at a step only if it reached every earlier step first. */
export const FUNNEL_STEPS = ['page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'purchase'] as const satisfies readonly TrackEventName[];

/** rows: first time each session fired each step. Returns sessions reaching each step in order. */
export function funnelCounts(rows: readonly { sessionId: string; name: string; at: Date }[], steps: readonly string[] = FUNNEL_STEPS): number[] {
  const bySession = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = bySession.get(r.sessionId) ?? new Map<string, number>();
    const t = r.at.getTime();
    if (!m.has(r.name) || m.get(r.name)! > t) m.set(r.name, t);
    bySession.set(r.sessionId, m);
  }
  const counts = steps.map(() => 0);
  for (const m of bySession.values()) {
    let last = -Infinity;
    for (let i = 0; i < steps.length; i++) {
      const t = m.get(steps[i]!);
      if (t === undefined || t < last) break;
      counts[i]!++;
      last = t;
    }
  }
  return counts;
}

/** Consecutive repeats removed, first `max` pages joined with an arrow: the key used for path explorer rows. */
export function pathKey(paths: readonly string[], max = 4): string {
  const out: string[] = [];
  for (const p of paths) if (out[out.length - 1] !== p) out.push(p);
  return out.slice(0, max).join(' → ');
}

export type VitalMetric = 'LCP' | 'INP' | 'CLS' | 'TTFB';
export const VITAL_METRICS: readonly VitalMetric[] = ['LCP', 'INP', 'CLS', 'TTFB'];
const THRESHOLDS: Record<VitalMetric, [good: number, poor: number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  TTFB: [800, 1800],
};

/** Core Web Vitals rating of a p75 value. */
export function vitalRating(metric: VitalMetric, value: number): 'good' | 'needs-improvement' | 'poor' {
  const [good, poor] = THRESHOLDS[metric];
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
}

/** Change against the previous period; null when the previous period had nothing (shown as "new", not +100%). */
export function delta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}
