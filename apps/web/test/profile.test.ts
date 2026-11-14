import { describe, expect, it } from 'vitest';
import { validateDisplayName } from '../src/lib/profile.js';

const messages = { tooShort: 'کوتاه', tooLong: 'بلند', phoneLike: 'شماره مجاز نیست' };

describe('display name validation (E1-05)', () => {
  it('trims and accepts a Persian name', () => {
    expect(validateDisplayName('  رضا بنزین  ', messages)).toEqual({
      displayName: 'رضا بنزین',
      error: null,
    });
  });

  it('treats an empty field as a request to clear the name', () => {
    expect(validateDisplayName('', messages)).toEqual({ displayName: null, error: null });
    expect(validateDisplayName('   ', messages)).toEqual({ displayName: null, error: null });
  });

  it('rejects a single character and anything above sixty', () => {
    expect(validateDisplayName('ر', messages).error).toBe(messages.tooShort);
    expect(validateDisplayName('x'.repeat(61), messages).error).toBe(messages.tooLong);
    expect(validateDisplayName('x'.repeat(60), messages).error).toBeNull();
  });

  it('refuses phone-like strings in every common shape', () => {
    expect(validateDisplayName('09123456789', messages).error).toBe(messages.phoneLike);
    expect(validateDisplayName('+98 912 345 6789', messages).error).toBe(messages.phoneLike);
    expect(validateDisplayName('(0912) 345-6789', messages).error).toBe(messages.phoneLike);
  });

  it('keeps a name that merely contains digits', () => {
    expect(validateDisplayName('رضا ۲۴', messages)).toEqual({
      displayName: 'رضا ۲۴',
      error: null,
    });
  });
});
