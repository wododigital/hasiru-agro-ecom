import 'server-only';

// Public server API of shipping (BUILD-PLAN 2.5): quotes, vehicles, slots, bookings, reminders, seed, runtime binding.
export { configureShipping, shippingRuntime, type PincodeHit, type ShippingRuntimeInput } from './runtime';
export { loadConfig, distanceOverride, type ShippingConfig } from './config';
export { quoteMethods, pickVehicle, planFor, listVehicles, packingFee, nextSlots, bookedKgFrom, shippingQuoter, type SlotOptions } from './quote';
export { bookSlot, cancelBooking, slotLoad, type BookSlotInput, type BookSlotResult } from './bookings';
export { sendSlotReminders, slotRemindersJob, onOrderCancelled, onPaymentFailed } from './jobs';
export { seedHook, loadShippingSeed, readShippingSeed } from './seed';
