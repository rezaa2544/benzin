import { describe, expect, it } from 'vitest';
import {
  buyerSavingToman,
  isAboveOfficialRate,
  isSuspiciouslyLow,
  orderTotalToman,
} from '../src/domain/pricing.js';
import { haversineKm } from '../src/infra/memory/index.js';

describe('pricing', () => {
  it('computes the order total from litres and rate', () => {
    expect(orderTotalToman(20, 2600)).toBe(52_000);
    expect(orderTotalToman(12.5, 2100)).toBe(26_250);
  });

  it('computes the buyer saving against the official rate', () => {
    expect(buyerSavingToman('T3000', 20, 2600)).toBe(8_000);
    expect(buyerSavingToman('T1500', 10, 1400)).toBe(1_000);
  });

  it('flags prices above the official rate', () => {
    expect(isAboveOfficialRate('T1500', 1600)).toBe(true);
    expect(isAboveOfficialRate('T1500', 1500)).toBe(false);
  });

  it('flags suspiciously low prices', () => {
    expect(isSuspiciouslyLow('T3000', 1200, 30)).toBe(true);
    expect(isSuspiciouslyLow('T3000', 2400, 30)).toBe(false);
  });
});

describe('haversine distance', () => {
  it('measures the Tehran–Karaj gap within 1 km', () => {
    const tehran = { lat: 35.6892, lng: 51.389 };
    const karaj = { lat: 35.8355, lng: 50.9915 };
    const km = haversineKm(tehran, karaj);
    expect(km).toBeGreaterThan(35);
    expect(km).toBeLessThan(41);
  });

  it('is zero for identical points', () => {
    expect(haversineKm({ lat: 35.7, lng: 51.4 }, { lat: 35.7, lng: 51.4 })).toBe(0);
  });
});
