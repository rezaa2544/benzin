import { describe, expect, it } from 'vitest';
import { fmtDate, fmtNumber, fmtToman, statusFa } from '../src/lib/format.js';

describe('admin formatting (E8-01)', () => {
  it('renders money with Persian digits and the «٬» separator', () => {
    expect(fmtToman(49_000)).toContain('۴۹٬۰۰۰');
    expect(fmtToman(49_000)).toContain('تومان');
  });

  it('renders counts in Persian digits and dates in Jalali', () => {
    expect(fmtNumber(1234)).toBe('۱۲۳۴');
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('2026-01-01T09:00:00.000Z')).toMatch(/[۰-۹]/);
  });

  it('translates the statuses the API returns', () => {
    expect(statusFa('DISPUTED')).toBe('اختلاف');
    expect(statusFa('MOON')).toBe('MOON');
  });
});
