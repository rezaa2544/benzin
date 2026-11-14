import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  effectiveSort,
  filtersFromQuery,
  TIER_LABEL_FA,
  toSearchQuery,
} from '../src/lib/market.js';

describe('market filters (E9-05)', () => {
  it('falls back to the defaults for missing or invalid query values', () => {
    expect(filtersFromQuery({})).toEqual(DEFAULT_FILTERS);
    expect(filtersFromQuery({ side: 'NOPE', tier: 'T9', sort: 'random' })).toEqual(DEFAULT_FILTERS);
  });

  it('reads a full filter set from the URL', () => {
    expect(filtersFromQuery({ zoneId: 'z1', side: 'SELL', tier: 'T10000', sort: 'price' })).toEqual(
      { zoneId: 'z1', side: 'SELL', tier: 'T10000', sort: 'price' },
    );
  });

  it('only uses distance when there is an origin point', () => {
    expect(effectiveSort({ ...DEFAULT_FILTERS, sort: 'distance' }, false)).toBe('newest');
    expect(effectiveSort({ ...DEFAULT_FILTERS, sort: 'distance' }, true)).toBe('distance');
    expect(effectiveSort({ ...DEFAULT_FILTERS, sort: 'price' }, false)).toBe('price');
  });

  it('omits the origin from the API query when there is none', () => {
    const query = toSearchQuery({ ...DEFAULT_FILTERS, zoneId: 'z1' });
    expect(query['zoneId']).toBe('z1');
    expect(query['limit']).toBe(20);
    expect(query['lat']).toBeUndefined();
    expect(query['sort']).toBe('newest');
  });

  it('passes the cursor and origin through to the search', () => {
    const query = toSearchQuery(
      { ...DEFAULT_FILTERS, sort: 'distance' },
      { cursor: 'c1', origin: { lat: 35, lng: 46 }, limit: 5 },
    );
    expect(query).toMatchObject({ cursor: 'c1', lat: 35, lng: 46, limit: 5, sort: 'distance' });
  });

  it('labels every tier in Persian', () => {
    expect(Object.values(TIER_LABEL_FA).every((label) => /\S/.test(label))).toBe(true);
    expect(Object.keys(TIER_LABEL_FA)).toHaveLength(3);
  });
});
