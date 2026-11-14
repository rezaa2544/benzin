/** Geo primitives shared by the in-memory zone lookup and the seed data (task E2-01). */

export type LngLat = readonly [number, number];

/**
 * Ray-casting point-in-polygon on a lng/lat ring.
 * The ring may be open or closed (first point repeated); both are accepted.
 */
export function pointInPolygon(
  point: { lat: number; lng: number },
  ring: readonly LngLat[],
): boolean {
  if (ring.length < 3) return false;
  const closes =
    ring[0]?.[0] === ring[ring.length - 1]?.[0] && ring[0]?.[1] === ring[ring.length - 1]?.[1];
  const vertices = closes ? ring.slice(0, -1) : ring;

  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const [xi, yi] = vertices[i] as LngLat;
    const [xj, yj] = vertices[j] as LngLat;
    const intersects = yi > point.lat !== yj > point.lat;
    if (intersects && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Approximate bounding box of a ring — used for fast rejection before the exact test. */
export function boundingBox(ring: readonly LngLat[]): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  for (const [lng, lat] of ring) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** "lng lat,lng lat,..." — the body of `POLYGON((...))`, for WKT/PostGIS seeding. */
export function ringToWktCoordinates(ring: readonly LngLat[]): string {
  const closed = ring[0] === ring[ring.length - 1] ? ring : [...ring, ring[0] as LngLat];
  return closed.map(([lng, lat]) => `${lng} ${lat}`).join(',');
}

export function ringToWktPolygon(ring: readonly LngLat[]): string {
  return `POLYGON((${ringToWktCoordinates(ring)}))`;
}

/**
 * Privacy grid used for every coordinate that leaves the API (task E2-02).
 * Two decimals ≈ 1.1 km at Iranian latitudes: enough to say "around this
 * neighbourhood", not enough to identify a household.
 */
export const PRIVACY_GRID_DECIMALS = 2;

/** Approximate ground size of one grid cell, in metres, for a given precision. */
export function precisionMetersForDecimals(decimals = PRIVACY_GRID_DECIMALS): number {
  return Math.round(111_320 / 10 ** decimals);
}

/**
 * Snaps a point to the nearest privacy-grid centre. The result is deterministic,
 * so repeated reads of the same order always show the same approximate spot.
 */
export function snapToGrid(
  point: { lat: number; lng: number },
  decimals = PRIVACY_GRID_DECIMALS,
): { lat: number; lng: number } {
  const factor = 10 ** decimals;
  const snap = (value: number) => Math.round(value * factor) / factor;
  return { lat: snap(point.lat), lng: snap(point.lng) };
}

/** Great-circle distance in metres. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

export interface PublicLocation {
  lat: number;
  lng: number;
  /** Always true: the API never exposes the exact point (task E2-02). */
  approximate: true;
  precisionMeters: number;
}

/** The only sanctioned way to put coordinates into a response. */
export function publicLocation(
  point: { lat: number; lng: number } | null | undefined,
): PublicLocation | null {
  if (!point) return null;
  const snapped = snapToGrid(point, PRIVACY_GRID_DECIMALS);
  return {
    lat: snapped.lat,
    lng: snapped.lng,
    approximate: true,
    precisionMeters: precisionMetersForDecimals(PRIVACY_GRID_DECIMALS),
  };
}
