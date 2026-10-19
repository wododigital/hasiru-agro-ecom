import 'server-only';
import { db } from '@ecomkit/core/db';
import { buildSnapshot, createPlacesReader, type PlacesSnapshot } from './reader';

/** Districts change by admin edit or re-seed only; five minutes bounds staleness across the web and worker processes. */
const TTL_MS = 5 * 60_000;
let snapshot: Promise<PlacesSnapshot> | null = null;
let loadedAt = 0;

export function getSnapshot(): Promise<PlacesSnapshot> {
  if (!snapshot || Date.now() - loadedAt > TTL_MS) {
    loadedAt = Date.now();
    snapshot = buildSnapshot(db).catch((err) => {
      snapshot = null;
      throw err;
    });
  }
  return snapshot;
}

/** Call after any write to places tables. */
export function invalidatePlacesCache(): void {
  snapshot = null;
}

export const places = createPlacesReader(getSnapshot);
