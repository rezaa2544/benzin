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
