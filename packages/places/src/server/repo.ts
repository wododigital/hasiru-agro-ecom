import 'server-only';
import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@ecomkit/core/db';
import { placesDistrict, placesPincode, placesState } from '../schema';

export type DistrictRow = typeof placesDistrict.$inferSelect;
export type StateRow = typeof placesState.$inferSelect;

export async function loadStates(db: DbOrTx): Promise<StateRow[]> {
  return db.select().from(placesState).orderBy(placesState.name);
}

export async function loadDistricts(db: DbOrTx): Promise<DistrictRow[]> {
  return db.select().from(placesDistrict).orderBy(placesDistrict.slug);
}

export async function findDistrictBySlug(db: DbOrTx, slug: string): Promise<DistrictRow | null> {
  const [row] = await db.select().from(placesDistrict).where(eq(placesDistrict.slug, slug)).limit(1);
  return row ?? null;
}

export interface PincodeHit {
  pincode: string;
  officeName: string;
  stateCode: string;
  districtSlug: string | null;
}

/** One pincode to its office, state and (when matched) district. Null for an unknown pincode. */
export async function findPincode(db: DbOrTx, pincode: string): Promise<PincodeHit | null> {
  const [row] = await db
    .select({
      pincode: placesPincode.pincode,
      officeName: placesPincode.officeName,
      stateCode: placesPincode.stateCode,
      districtSlug: placesDistrict.slug,
    })
    .from(placesPincode)
    .leftJoin(placesDistrict, eq(placesDistrict.id, placesPincode.districtId))
    .where(eq(placesPincode.pincode, pincode))
    .limit(1);
  return row ?? null;
}

export async function countPincodes(db: DbOrTx): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(placesPincode);
  return row?.n ?? 0;
}
