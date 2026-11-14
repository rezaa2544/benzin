import { describe, expect, it } from 'vitest';
import { boundingBox, pointInPolygon, ringToWktPolygon } from '../src/domain/geo.js';
import { BANEH_ZONE } from '../src/infra/db/seed.js';

const square = [
  [45.8, 35.9],
  [46.0, 35.9],
  [46.0, 36.1],
  [45.8, 36.1],
] as const;

describe('point in polygon', () => {
  it('accepts a point inside', () => {
    expect(pointInPolygon({ lat: 36.0, lng: 45.9 }, square)).toBe(true);
  });

  it('rejects a point outside', () => {
    expect(pointInPolygon({ lat: 36.5, lng: 45.9 }, square)).toBe(false);
    expect(pointInPolygon({ lat: 36.0, lng: 47.0 }, square)).toBe(false);
  });

  it('handles an explicitly closed ring', () => {
    const closed = [...square, square[0]] as const;
    expect(pointInPolygon({ lat: 36.0, lng: 45.9 }, closed)).toBe(true);
    expect(pointInPolygon({ lat: 30.0, lng: 45.9 }, closed)).toBe(false);
  });

  it('treats a degenerate ring as empty', () => {
    expect(pointInPolygon({ lat: 36, lng: 45.9 }, [[45.8, 35.9]] as const)).toBe(false);
  });

  it('works with the seeded Baneh polygon', () => {
    expect(pointInPolygon({ lat: 35.998, lng: 45.885 }, BANEH_ZONE.boundary)).toBe(true);
    expect(pointInPolygon({ lat: 35.69, lng: 51.38 }, BANEH_ZONE.boundary)).toBe(false); // Tehran
  });
});

describe('geometry helpers', () => {
  it('computes a bounding box', () => {
    expect(boundingBox(BANEH_ZONE.boundary)).toEqual({
      minLat: 35.955,
      maxLat: 36.07,
      minLng: 45.82,
      maxLng: 45.96,
    });
  });

  it('emits a closed WKT polygon', () => {
    const wkt = ringToWktPolygon(square);
    expect(wkt.startsWith('POLYGON((')).toBe(true);
    expect(wkt.endsWith('))')).toBe(true);
    expect(wkt).toContain('45.8 35.9,46 35.9,46 36.1,45.8 36.1,45.8 35.9');
  });
});
