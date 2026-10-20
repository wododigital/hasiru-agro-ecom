import type { KeyboardEvent } from 'react';
import type { Role } from '@ecomkit/core/contracts';
import { CANOPY_RADIUS_FT, scaleBarFt, type PatchPoint, type ViewerData } from '../domain';

const ROLE_VAR: Record<Role, string> = { M: 'var(--color-role-main)', X: 'var(--color-role-host)', O: 'var(--color-role-biomass)' };

export interface Plan2dProps {
  data: ViewerData;
  /** Accessible name of the drawing. */
  label: string;
  /** "{n} ft" template for the dimension labels and the scale bar. */
  feet: string;
  selected?: PatchPoint | null;
  onPick?: (p: PatchPoint | null) => void;
}

/**
 * Flat top view in feet (the SVG viewBox is the ground), plants drawn as canopy footprints with a role dot.
 * No canvas and no three: it renders on the server and is the default under reduced motion.
 */
export function Plan2d({ data, label, feet, selected, onPick }: Plan2dProps) {
  const { plant, row } = data.spacing;
  const f = data.scale;
  const W = data.extent.w - plant;
  const D = Math.max(0, data.extent.d - row);
  const mx = plant * 1.5 + 6 * f;
  const mz = row * 1.5 + 6 * f;
  const x0 = -mx;
  const z0 = -mz - 2;
  const vw = W + 2 * mx;
  const vh = D + 2 * mz + 6;
  const unit = Math.max(vw, vh) / 100; // label and stroke sizes scale with the drawing
  const bar = scaleBarFt(Math.max(W, D));
  const ft = (n: number) => feet.replace('{n}', String(n));
  const key = (p: PatchPoint) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick?.(p);
    }
  };

  return (
    <svg viewBox={`${x0} ${z0} ${vw} ${vh}`} role="img" aria-label={label} className="h-full w-full bg-surface-2" preserveAspectRatio="xMidYMid meet">
      <title>{label}</title>
      <rect x={-plant / 2} y={-row / 2} width={W + plant} height={D + row} className="fill-border/60" />
      {data.raised
        ? Array.from({ length: Math.round(D / row) + 1 }, (_, i) => (
            <line key={i} x1={x0} x2={x0 + vw} y1={i * row} y2={i * row} className="stroke-muted/40" strokeWidth={unit * 0.6} />
          ))
        : null}
      {data.points.map((p) => {
        const r = CANOPY_RADIUS_FT[p.archetype] * f;
        const dot = Math.max(unit * 1.4, Math.min(r * 0.45, unit * 2.6));
        const on = selected === p;
        return (
          <g
            key={`${p.x}-${p.z}`}
            role={onPick ? 'button' : undefined}
            tabIndex={onPick ? 0 : undefined}
            aria-label={onPick ? p.name : undefined}
            onClick={onPick ? () => onPick(on ? null : p) : undefined}
            onKeyDown={onPick ? key(p) : undefined}
            className={onPick ? 'cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-text' : undefined}
          >
            <circle cx={p.x} cy={p.z} r={r} fill={ROLE_VAR[p.role]} fillOpacity={0.18} stroke={ROLE_VAR[p.role]} strokeOpacity={on ? 1 : 0.6} strokeWidth={unit * (on ? 0.6 : 0.25)} />
            <circle cx={p.x} cy={p.z} r={dot} fill={ROLE_VAR[p.role]} />
            <text x={p.x} y={p.z} textAnchor="middle" dominantBaseline="central" fontSize={dot * 1.1} fontWeight={700} className="fill-primary-fg select-none">
              {p.role}
            </text>
          </g>
        );
      })}
      <rect x={-plant / 2} y={-row / 2} width={W + plant} height={D + row} fill="none" className="stroke-accent" strokeWidth={unit * 0.4} strokeDasharray={`${unit * 1.5} ${unit}`} />
      <g className="fill-primary stroke-primary" fontSize={unit * 2.4} fontWeight={600}>
        <line x1={0} x2={plant} y1={-row / 2 - unit * 3} y2={-row / 2 - unit * 3} strokeWidth={unit * 0.3} />
        <text x={plant / 2} y={-row / 2 - unit * 4.2} textAnchor="middle" stroke="none">
          {ft(plant)}
        </text>
        {D > 0 ? (
          <>
            <line x1={W + plant / 2 + unit * 3} x2={W + plant / 2 + unit * 3} y1={0} y2={row} strokeWidth={unit * 0.3} />
            <text x={W + plant / 2 + unit * 4} y={row / 2} dominantBaseline="central" stroke="none">
              {ft(row)}
            </text>
          </>
        ) : null}
        <rect x={x0 + vw - bar - unit * 2} y={z0 + vh - unit * 4} width={bar} height={unit * 0.8} stroke="none" />
        <text x={x0 + vw - unit * 2} y={z0 + vh - unit * 1} textAnchor="end" stroke="none">
          {ft(bar)}
        </text>
      </g>
    </svg>
  );
}
