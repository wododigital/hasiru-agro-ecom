// Admin display helpers: IST times and short relative ages.
const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export const ist = (d: Date | null | undefined): string => (d ? IST.format(d) : '');

export function ago(d: Date | null | undefined, now = new Date()): string {
  if (!d) return 'never';
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172_800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

export const pct = (ratio: number | null | undefined): string => (ratio == null ? 'n/a' : `${Math.round(ratio * 1000) / 10}%`);

export const severityTone = { critical: 'danger', high: 'warning', low: 'neutral' } as const;
