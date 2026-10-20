import 'server-only';

import type { CartBlockProps } from '@ecomkit/core/contracts';
import { loadConfig } from '@ecomkit/shipping/server';
import { cartWeightKg, meterState, type MeterState } from '../domain';

export { configureTruckMeter, truckMeterCopy } from './runtime';

/** Meter for a cart block, or null when there is nothing to show: empty cart, no fleet, or pickup chosen. */
export async function meterFor(props: Pick<CartBlockProps, 'lines' | 'selectedMethodId'>): Promise<{ state: MeterState | null; hidden: boolean }> {
  const { vehicles, methods } = await loadConfig();
  const pickup = props.selectedMethodId !== null && methods.some((m) => m.id === props.selectedMethodId && m.kind === 'pickup');
  return { state: meterState(cartWeightKg(props.lines), vehicles), hidden: pickup || vehicles.length === 0 };
}
