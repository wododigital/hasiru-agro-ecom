import type { PlanLayout, Role } from '@ecomkit/core/contracts';
import { cn } from '@ecomkit/ui';
import { plantingMessages, type PlantingMessages } from '../messages';
import { PlanTooltipIsland } from './PlanTooltipIsland';
import { ROLE_BG, ROLE_FILL } from './roles';

const SCALE = 10; // svg units per foot

export interface PlanDiagramProps {
  layout: PlanLayout;
  /** Role names from the model legend (admin data), falling back to messages. */
  legend?: Partial<Record<Role, string>>;
  messages?: PlantingMessages;
  className?: string;
}

/**
 * The model's repeating block as server-rendered SVG: soil square, 6 ft grid, axis labels every 12 ft, one dot per plant
 * coloured by role (letters when the dot is large enough). Edge dots belong to the next block and are drawn faint.
 * Hover, tap and keyboard tooltips come from a 2 KB island; screen readers get <title>/<desc> and a text list.
 */
export function PlanDiagram({ layout, legend, messages = plantingMessages, className }: PlanDiagramProps) {
  const m = messages.results;
  const { w, h } = layout.blockFt;
  const line = h === 0;
  const innerH = line ? 4 : h;
  const step = Math.min(layout.spacingFt.plant, line ? layout.spacingFt.plant : layout.spacingFt.row);
  const r = Math.max(5, Math.min(16, step * SCALE * 0.36));
  // Dots sit on the block edges, so the padding grows with the dot radius (axis labels clear the dots).
  const PAD = { l: r + 30, t: r + 6, r: r + 6, b: r + 24 };
  const width = w * SCALE + PAD.l + PAD.r;
  const height = innerH * SCALE + PAD.t + PAD.b;
  const grid = Array.from({ length: Math.floor(w / 6) + 1 }, (_, i) => i * 6);
  const gridY = line ? [] : Array.from({ length: Math.floor(h / 6) + 1 }, (_, i) => i * 6);
  const ticks = (n: number) => Array.from({ length: Math.floor(n / 12) + 1 }, (_, i) => i * 12).filter((v) => v <= n);
  const id = `plan-${layout.modelSlug}`;
  const name = (role: Role) => legend?.[role] ?? messages.roles[role];
  const names = (ids: readonly string[]) => [...new Set(ids.map((pid) => layout.points.find((p) => p.productId === pid)?.label).filter(Boolean))].join(', ');
  const tipTitle = (role: Role, label: string) => [name(role), label || name(role)].join(': ');
  const cy = (y: number) => PAD.t + (line ? 2 : y) * SCALE;

  return (
    <figure className={cn('space-y-3', className)}>
      <PlanTooltipIsland label={line ? m.diagramLineTitle : m.diagramTitle}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-t ${id}-d`} className="h-auto w-full max-w-[560px] select-none">
          <title id={`${id}-t`}>{line ? m.diagramLineTitle : m.diagramTitle}</title>
          <desc id={`${id}-d`}>{m.diagramDesc}</desc>
          <rect x={PAD.l} y={PAD.t} width={w * SCALE} height={innerH * SCALE} rx={6} className="fill-surface-2 stroke-border" />
          <g className="stroke-border" strokeWidth={1}>
            {grid.map((x) => (
              <line key={`gx${x}`} x1={PAD.l + x * SCALE} x2={PAD.l + x * SCALE} y1={PAD.t} y2={PAD.t + innerH * SCALE} />
            ))}
            {gridY.map((y) => (
              <line key={`gy${y}`} y1={PAD.t + y * SCALE} y2={PAD.t + y * SCALE} x1={PAD.l} x2={PAD.l + w * SCALE} />
            ))}
          </g>
          <g className="fill-muted text-[11px]" aria-hidden="true">
            {ticks(w).map((x) => (
              <text key={`tx${x}`} x={PAD.l + x * SCALE} y={height - 10} textAnchor="middle">
                {x}
              </text>
            ))}
            {line
              ? null
              : ticks(h).map((y) => (
                  <text key={`ty${y}`} x={PAD.l - r - 6} y={PAD.t + y * SCALE + 4} textAnchor="end">
                    {y}
                  </text>
                ))}
            <text x={width - PAD.r} y={height - 10} textAnchor="end">
              {m.feet}
            </text>
          </g>
          <g>
            {layout.points.map((p, i) => {
              const edge = p.x >= w || (!line && p.y >= h);
              return (
                <g key={i} data-tip={`${p.role}: ${p.label || name(p.role)} (${p.x}, ${p.y} ${m.feet})`} className={edge ? 'opacity-40' : undefined}>
                  <circle cx={PAD.l + p.x * SCALE} cy={cy(p.y)} r={r} className={cn(ROLE_FILL[p.role], 'stroke-surface')} strokeWidth={1.5}>
                    <title>{tipTitle(p.role, p.label)}</title>
                  </circle>
                  {r >= 8 ? (
                    <text x={PAD.l + p.x * SCALE} y={cy(p.y) + 4} textAnchor="middle" className="pointer-events-none fill-text text-[11px] font-semibold" aria-hidden="true">
                      {p.role}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      </PlanTooltipIsland>
      <figcaption>
        <ul className="grid gap-2 sm:grid-cols-3" aria-label={m.legend}>
          {layout.legend.map((l) => (
            <li key={l.role} className="flex items-start gap-2 text-sm">
              <span aria-hidden="true" className={cn('mt-1 inline-block size-3 shrink-0 rounded-full', ROLE_BG[l.role])} />
              <span>
                <b>{l.role}</b> <span className="font-semibold">{name(l.role)}</span> <span className="text-muted tabular-nums">· {l.perBlock}</span>
                <span className="block text-xs text-muted">{names(l.productIds)}</span>
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
