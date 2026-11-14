import { describe, expect, it } from 'vitest';
import { containsPhoneNumber, maskPhoneNumbers } from '../src/chat.js';

describe('chat contact masking', () => {
  it('masks a bare mobile number', () => {
    const masked = maskPhoneNumbers('شماره من 09121234567 است');
    expect(masked.maskedCount).toBe(1);
    expect(masked.body).toBe('شماره من ۰۹۱۲•••••۶۷ است');
    expect(containsPhoneNumber(masked.body)).toBe(false);
  });

  it('masks every number in one message', () => {
    const masked = maskPhoneNumbers('۰۹۱۲۱۲۳۴۵۶۷ و 09351234567');
    expect(masked.maskedCount).toBe(2);
    expect(masked.body).not.toMatch(/[0-9۰-۹]{7,}/);
  });

  it('accepts country codes, separators and Persian digits', () => {
    for (const raw of ['+98 912 123 4567', '0098-912-123-4567', '0912.123.4567', '۹۱۲۱۲۳۴۵۶۷']) {
      const masked = maskPhoneNumbers(raw);
      expect(masked.maskedCount).toBe(1);
      expect(masked.body).toContain('۰۹۱۲');
    }
  });

  it('leaves ordinary numbers and text alone', () => {
    const text = 'قیمت ۲۶۰۰ تومان، ۲۰ لیتر، سفارش 1234';
    const masked = maskPhoneNumbers(text);
    expect(masked.maskedCount).toBe(0);
    expect(masked.body).toBe(text);
    expect(containsPhoneNumber(text)).toBe(false);
  });
});
