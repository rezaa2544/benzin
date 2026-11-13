import { describe, expect, it } from 'vitest';
import {
  createOrderSchema,
  iranMobileSchema,
  orderSearchSchema,
  otpCodeSchema,
} from '../src/schemas.js';

describe('iranMobileSchema', () => {
  it.each([
    ['09121234567', '09121234567'],
    ['+989121234567', '09121234567'],
    ['00989121234567', '09121234567'],
    ['0912 123 4567', '09121234567'],
    ['۰۹۱۲۱۲۳۴۵۶۷', '09121234567'],
  ])('normalises %s', (input, expected) => {
    expect(iranMobileSchema.parse(input)).toBe(expected);
  });

  it('rejects landlines and short numbers', () => {
    expect(iranMobileSchema.safeParse('02112345678').success).toBe(false);
    expect(iranMobileSchema.safeParse('0912123456').success).toBe(false);
  });
});

describe('otpCodeSchema', () => {
  it('accepts persian digits', () => {
    expect(otpCodeSchema.parse('۱۲۳۴۵')).toBe('12345');
  });

  it('rejects the wrong length', () => {
    expect(otpCodeSchema.safeParse('1234').success).toBe(false);
  });
});

const zoneId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('createOrderSchema', () => {
  const base = {
    side: 'SELL',
    tier: 'T3000',
    litres: 20,
    rateToman: 2600,
    zoneId,
  };

  it('defaults the delivery method to the fuel card', () => {
    expect(createOrderSchema.parse(base).deliveryMethod).toBe('FUEL_CARD');
  });

  it('rejects sub-litre precision beyond two decimals', () => {
    expect(createOrderSchema.safeParse({ ...base, litres: 20.123 }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(createOrderSchema.safeParse({ ...base, hacked: true }).success).toBe(false);
  });

  it('rejects non-positive prices', () => {
    expect(createOrderSchema.safeParse({ ...base, rateToman: 0 }).success).toBe(false);
  });
});

describe('orderSearchSchema', () => {
  it('coerces query-string numbers and applies defaults', () => {
    const parsed = orderSearchSchema.parse({ zoneId, side: 'BUY', tier: 'T1500', limit: '10' });
    expect(parsed.limit).toBe(10);
    expect(parsed.sort).toBe('distance');
  });

  it('caps the page size', () => {
    expect(
      orderSearchSchema.safeParse({ zoneId, side: 'BUY', tier: 'T1500', limit: '500' }).success,
    ).toBe(false);
  });
});
