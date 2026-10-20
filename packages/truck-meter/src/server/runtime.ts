import { truckMeterMessages, type TruckMeterMessages } from '../messages';

// The host binds copy overrides once at boot: configureTruckMeter({ messages: { note: '...' } }).
const KEY = Symbol.for('ecomkit.truck-meter.runtime');
type Holder = { [KEY]?: TruckMeterMessages };

export function configureTruckMeter(input: { messages?: Partial<TruckMeterMessages> }): void {
  (globalThis as Holder)[KEY] = { ...truckMeterMessages, ...input.messages };
}

export function truckMeterCopy(): TruckMeterMessages {
  return (globalThis as Holder)[KEY] ?? truckMeterMessages;
}
