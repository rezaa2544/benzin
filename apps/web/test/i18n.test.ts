import { describe, expect, it } from 'vitest';
import { dictionary, keysOf, t, tf } from '../src/lib/i18n.js';

const keys = keysOf(dictionary);

describe('Persian dictionary (E9-01)', () => {
  it('has no empty string and no duplicated key', () => {
    expect(keys.length).toBeGreaterThan(70);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(t(key), key).not.toBe(key);
      expect(t(key).trim().length, key).toBeGreaterThan(0);
    }
  });

  it('covers the sections every screen needs', () => {
    for (const prefix of ['app', 'nav', 'common', 'order', 'form', 'otp', 'styleGuide', 'tier']) {
      expect(
        keys.some((key) => key.startsWith(`${prefix}.`)),
        prefix,
      ).toBe(true);
    }
  });

  it('returns the path for a missing key instead of an empty label', () => {
    expect(t('nope.missing')).toBe('nope.missing');
  });

  it('fills placeholders', () => {
    expect(tf('otp.resendIn', { seconds: 30 })).toContain('30');
    expect(tf('otp.resendIn', { seconds: 30 })).not.toContain('{seconds}');
  });
});
