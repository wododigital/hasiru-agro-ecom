const EARTH_KM = 6371.0088;
/** Straight-line distance to road distance (BUILD-PLAN 9.6). */
export const ROAD_FACTOR = 1.3;

export interface LatLng {
  lat: number;
  lng: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Road-distance estimate in whole km, rounded to the nearest 5 so it does not pretend to be exact. */
export function roadDistanceKm(from: LatLng, to: LatLng): number {
  return Math.round((haversineKm(from, to) * ROAD_FACTOR) / 5) * 5;
}

/** Nearest item by straight-line distance ("use my location"). Null for an empty list. */
export function nearest<T extends LatLng>(point: LatLng, items: readonly T[]): T | null {
  let best: T | null = null;
  let bestKm = Infinity;
  for (const it of items) {
    const km = haversineKm(point, it);
    if (km < bestKm) {
      bestKm = km;
      best = it;
    }
  }
  return best;
}
