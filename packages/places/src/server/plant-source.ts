import 'server-only';
import type { ImageRef } from '@ecomkit/core/contracts';
import type { FitInput } from '../domain';

/** A plant as the district page needs it. The catalog (or the app) supplies these; places never reads catalog tables. */
export interface DistrictPlant {
  sku: string;
  name: string;
  nameKn?: string | null;
  /** Storefront path, e.g. `/plant/alphonso-mango`. */
  path: string;
  image?: ImageRef | null;
  /** Already formatted, e.g. `Rs 490`. */
  priceLabel?: string | null;
  climate: FitInput;
}

export type PlantSource = () => Promise<DistrictPlant[]>;

const KEY = Symbol.for('ecomkit.places.plantSource');
type Holder = { [KEY]?: PlantSource };

/**
 * The app wires this once at boot (for example from the catalog's active plants with their climate).
 * Held on globalThis so the route bundle and the admin bundle see the same function.
 */
export function registerPlantSource(source: PlantSource | null): void {
  const holder = globalThis as Holder;
  if (source) holder[KEY] = source;
  else delete holder[KEY];
}

export async function loadDistrictPlants(): Promise<DistrictPlant[] | null> {
  const source = (globalThis as Holder)[KEY];
  return source ? source() : null;
}
