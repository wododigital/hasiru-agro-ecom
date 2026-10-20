import type { CartBlockProps } from '@ecomkit/core/contracts';
import { cn } from '@ecomkit/ui';
import type { TruckMeterMessages } from '../messages';
import { meterFor, truckMeterCopy } from '../server';
import type { MeterState } from '../domain';

function Bar({ state, label }: { state: MeterState; label: string }) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={state.fillPct}
      className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div className={cn('h-full rounded-full', state.nicelyPacked ? 'bg-success' : 'bg-accent')} style={{ width: `${state.fillPct}%` }} />
    </div>
  );
}

function TruckIcon() {
  return (
    <svg aria-hidden="true" width="40" height="28" viewBox="0 0 44 30" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-primary">
      <rect x="1" y="5" width="26" height="17" rx="2" />
      <path d="M27 10h9l6 7v5H27z" />
      <circle cx="9" cy="25" r="3" />
      <circle cx="34" cy="25" r="3" />
    </svg>
  );
}

/** The full meter: vehicle, fill, room left at the same cost, and where the order moves up a vehicle. */
export function TruckMeterView({ state, m }: { state: MeterState | null; m: TruckMeterMessages }) {
  if (!state) return <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted">{m.empty}</p>;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4" data-truck-meter="">
      <div className="flex items-center gap-3">
        <TruckIcon />
        <div className="flex flex-col">
          <p className="font-semibold text-text">{m.title(state.vehicleName, state.fillPct, state.trips)}</p>
          <p className="text-sm text-muted">{m.weight(state.lastTripKg, state.capacityKg, state.trips)}</p>
        </div>
      </div>
      <Bar state={state} label={m.meterLabel} />
      <p className={cn('text-sm', state.nicelyPacked ? 'font-medium text-success' : 'text-text')}>
        {state.nicelyPacked ? m.nicelyPacked : m.addMore(state.addKg, state.addPct)}
      </p>
      {state.next && !state.nicelyPacked ? <p className="text-xs text-muted">{m.vehicleChange(state.next.aboveKg, state.next.vehicleName)}</p> : null}
      {m.note ? <p className="text-xs text-muted">{m.note}</p> : null}
    </section>
  );
}

/** The compact bar (checkout summary, small orders): same numbers, one line. */
export function SmallOrderBarView({ state, m }: { state: MeterState | null; m: TruckMeterMessages }) {
  if (!state) return null;
  return (
    <div className="flex flex-col gap-1.5" data-truck-meter="bar">
      <Bar state={state} label={m.meterLabel} />
      <p className="text-xs text-muted">{state.nicelyPacked ? m.barFull : m.bar(state.fillPct, state.addKg)}</p>
    </div>
  );
}

/** Cart block (placement `cart`). */
export async function TruckMeterBlock(props: CartBlockProps) {
  const { state, hidden } = await meterFor(props);
  return hidden ? null : <TruckMeterView state={state} m={truckMeterCopy()} />;
}

/** Cart block (placement `checkout-summary`): the small-order bar. */
export async function SmallOrderBarBlock(props: CartBlockProps) {
  const { state, hidden } = await meterFor(props);
  return hidden ? null : <SmallOrderBarView state={state} m={truckMeterCopy()} />;
}
