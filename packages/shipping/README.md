# @ecomkit/shipping

Delivery for a store that ships by its own vehicles: zones, pickup / local slot / outstation methods, vehicle choice and trips, a weekly slot calendar with cutoff and capacity, packing fees, distance overrides and a delivery date promise. Provides the `shipping` service (shipping-method contract in `@ecomkit/core/contracts`).

Hard dependency: `core`. Optional: `places` (road distance for outstation quotes, pincode lookup), bound by the host.

## Rules

- **Zones** (A9): an address resolves by district slug first, then by state code. A district listed on any zone beats a state listed on another, so "this city district = local" wins over "its state = outstation". An address in no zone, or in an `enquiry` zone, is delivery on request only (an `enquiry_only` marker quote).
- **Methods**: `pickup` (free, ready in `readyInDays`), `local_slot` (flat vehicle rate x trips, dates from the slot calendar, `slotsShown`), `outstation_distance` (whole km x vehicle per-km rate x trips, promise `minDays` to `maxDays`). A method with a zone applies only to addresses in that zone; with no zone it applies to any zone of its kind. Before an address is known, pickup and zone-less local methods are offered and outstation waits (`shipping.address_needed`).
- **Vehicles**: the smallest active vehicle whose capacity carries the order; heavier orders take repeated trips of the largest. Fill is the last trip, 1 to 100%. Weights compare in grams.
- **Slot calendar** (IST): one row per weekday with `cutoff_hours` before 00:00 IST of the slot day and an optional `capacity_kg`. A day is offered while `now` is strictly before its cutoff, it is not a blackout date (setting) and it has room for the order. Bookings lock the slot row, so two orders never take the same last room.
- **Packing**: per line, the first matching rule by position (`product` by product or variant ids, `size_class`, `qty_band` inclusive) sets the fee per unit; otherwise the line keeps its own per-unit fee (the variant's `packing_fee_paise`, passed by the cart). `order` rules add a flat fee once.
- **Distance**: `shipping_distance_override` (admin) first, then the places service estimate, else the outstation method is unavailable (`shipping.distance_unknown`).

Unavailable reasons are message keys (`shipping.*`, see `src/messages.ts` `reasons`).

## Public API

- `@ecomkit/shipping/server`: `quoteMethods(input, { now })`, `pickVehicle(kg)`, `planFor(kg)`, `listVehicles()`, `packingFee(lines)`, `nextSlots(n, { weightKg, now })`, `bookSlot({ orderId, orderNumber, slotDate, weightKg }, { tx, now })`, `cancelBooking(orderId, { tx })`, `slotLoad(date)`, `sendSlotReminders({ now })`, `loadConfig()`, `configureShipping({ places, resolvePincode })`, `shippingQuoter` (the service), `loadShippingSeed(seed)`.
- `@ecomkit/shipping/domain`: pure `planVehicle`, `nextVehicle`, `localCharge`, `outstationCharge`, `packingFee`, `openSlots`, `istDate`, `addDays`, `formatSlotDate`, `resolveZone`, `quoteAll`, zod schemas for method rules, packing matches and `shipping.json`.
- `@ecomkit/shipping/ui`: `DeliveryCheckSection` (PDP section), `DeliveryCheckIsland`.
- `@ecomkit/shipping/admin`: `DeliveryPanel` (the settings custom panel).

Lines passed to `quoteMethods` may carry `productId` and `sizeClass` beyond the contract so product and size-class packing rules can match.

Checkout calls `bookSlot` inside its place-order transaction for a `local_slot` order (the slot date the customer picked) and treats `{ ok: false }` as "pick another date".

## Tables

`shipping_zone`, `shipping_method`, `shipping_vehicle`, `shipping_slot`, `shipping_slot_booking` (one active booking per order, `reminded_at`, `cancelled_at`), `shipping_packing_rule`, `shipping_distance_override` (keyed by district slug). No FK to other modules.

## Routes

- `GET /api/delivery-check?pincode=560001&kg=12` or `?district=<slug>&state=KA&kg=12`: every method with dates and charge. Pincode needs the host's `resolvePincode` binding (else 422 `pincode_lookup_off`); unknown pincode 404; rate limited per visitor (setting).

## Settings

`/admin/settings/shipping` (rendered by admin-shell): `blackout_dates`, `delivery_check_rate_per_min`, then the Delivery panel (`customPanel`) for zones, methods (rules JSON), vehicles (Rs), weekly days, packing rules and distance overrides. Every write is permission-checked (`settings.write`) and audited.

## Events and jobs

- Emits `slot.reminder` (one per order booked for tomorrow, IST) from the job `shipping.slot-reminders`, scheduled hourly 08:00 to 20:00 IST. The event and `reminded_at` are written in one transaction, so reruns and parallel workers never remind twice.
- Consumes `order.cancelled` and `order.payment_failed`: the order's slot booking is released.

## Extension points

`provides.shipping`, `pdpSections` (`shipping.delivery-check`, aside), `settings.customPanel`, `seedHooks` (`shipping.setup`: `data/seed/shipping.json`, each table seeded only while empty, so admin edits survive re-seeds; money in whole rupees).

## Host binding

```ts
configureShipping({
  places: () => registry.service('places'),
  resolvePincode: async (pin) => { /* places pincode directory */ },
});
```

## Disable

Remove `shipping` from the app's module list. Cart and checkout read it through `registry.service('shipping')` and show no delivery methods; `truck-meter` depends on it and must be removed too.
