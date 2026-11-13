import { describe, expect, it } from 'vitest';
import {
  formatCountdown,
  formatJalaliDate,
  formatLitres,
  formatRelativeFa,
  formatToman,
  toAsciiDigits,
  toPersianDigits,
} from '../src/format.js';

describe('persian digits', () => {
  it('converts ascii digits to persian', () => {
    expect(toPersianDigits('order 1402')).toBe('order ۱۴۰۲');
  });

  it('round-trips through ascii', () => {
    expect(toAsciiDigits(toPersianDigits('09121234567'))).toBe('09121234567');
  });

  it('converts arabic-indic digits', () => {
    expect(toAsciiDigits('٠٩١٢')).toBe('0912');
  });
});

describe('money and volume formatting', () => {
  it('formats toman with group separators', () => {
    expect(formatToman(1_500_000)).toBe('۱٬۵۰۰٬۰۰۰ تومان');
  });

  it('rejects non-finite amounts', () => {
    expect(() => formatToman(Number.NaN)).toThrow(RangeError);
  });

  it('formats litres with the persian decimal separator', () => {
    expect(formatLitres(12.5)).toBe('۱۲٫۵ لیتر');
    expect(formatLitres(20)).toBe('۲۰ لیتر');
  });
});

describe('jalali dates', () => {
  it('renders a persian-calendar date in the Tehran timezone', () => {
    const text = formatJalaliDate('2026-01-01T10:00:00Z');
    expect(text).toMatch(/[۰-۹]/);
    expect(text).toContain('دی');
  });
});

describe('relative time and countdown', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('shows a persian countdown', () => {
    expect(formatCountdown(125_000)).toBe('۰۲:۰۵');
    expect(formatCountdown(-1000)).toBe('۰۰:۰۰');
  });

  it('describes the past in persian', () => {
    expect(formatRelativeFa('2026-06-01T11:55:00Z', now)).toBe('۵ دقیقه پیش');
  });

  it('describes the future in persian', () => {
    expect(formatRelativeFa('2026-06-01T14:00:00Z', now)).toBe('۲ ساعت دیگر');
  });
});
