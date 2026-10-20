# @ecomkit/truck-meter

Shows how full the delivery vehicle is for the cart's weight: vehicle and fill, room left at the same delivery cost ("Add about K kg (~P% more)"), "Nicely packed" at 90% and up, and where the order moves up a vehicle. A compact one-line bar (the small-order bar) goes in the checkout summary. No tables.

Hard dependencies: `core`, `cart`, `shipping` (vehicles and the vehicle choice live in `@ecomkit/shipping/domain`; this package adds only the meter maths and copy).

## Public API

- `@ecomkit/truck-meter/domain`: `cartWeightKg(lines)` (qty x per-unit `weightKg` from the cart-block contract), `meterState(kg, vehicles)`, `NICELY_PACKED_PCT` (90).
- `@ecomkit/truck-meter/ui`: `TruckMeterBlock` and `SmallOrderBarBlock` (cart blocks, server components, no client JS), `TruckMeterView` and `SmallOrderBarView` (pure views).
- `@ecomkit/truck-meter/server`: `meterFor(props)`, `configureTruckMeter({ messages })` for host copy (for example a `note` on how weights are estimated).

## Extension points

`cartBlocks`: `truck-meter` (placement `cart`, order 20) and `truck-meter.bar` (placement `checkout-summary`, order 20). Both hide when the selected method is pickup or no vehicle is set up; an empty cart shows the empty state in the cart and nothing in the summary.

## Settings, routes, events, jobs

None.

## Disable

Remove `truck-meter` from the app's module list; the cart renders its other blocks.
