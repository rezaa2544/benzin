import { toAsciiDigits, toPersianDigits } from './format.js';

/**
 * Chat presentation helpers (task E5-02).
 *
 * Phone numbers are the currency of an off-platform trade, so before the order owner
 * accepts a reservation the chat replaces every mobile number with a masked form. The
 * server does this — clients cannot opt out by sending raw text.
 */

/**
 * Matches Iranian mobiles with optional country code and common separators:
 * 09121234567 · 9121234567 · +98 912 123 4567 · 0098-912-123-4567
 */
const MOBILE_CANDIDATE =
  /(?<![0-9۰-۹٠-٩])(?:(?:\+98|0098)[\s\-.]?|[0۰])?[9۹](?:[\s\-.]?[0-9۰-۹٠-٩]){9}(?![0-9۰-۹٠-٩])/g;

const DIGITS_ONLY = /\D/g;

export interface MaskedText {
  readonly body: string;
  /** How many numbers were replaced; 0 means the text was stored verbatim. */
  readonly maskedCount: number;
}

/** Canonical 09XXXXXXXXX form of a raw candidate (best effort, no validation). */
const normalise = (candidate: string): string => {
  const digits = toAsciiDigits(candidate).replace(DIGITS_ONLY, '');
  if (digits.startsWith('0098')) return `0${digits.slice(4)}`;
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}`;
  return digits;
};

/** 09121234567 → ۰۹۱۲•••••۶۷ styled mask keeping the operator prefix and last two digits. */
const mask = (digits: string): string => {
  const visibleHead = digits.slice(0, 4);
  const visibleTail = digits.slice(-2);
  return toPersianDigits(
    `${visibleHead}${'•'.repeat(Math.max(0, digits.length - 6))}${visibleTail}`,
  );
};

/** Replaces every mobile number in free text with a masked placeholder. */
export function maskPhoneNumbers(text: string): MaskedText {
  let maskedCount = 0;
  const body = text.replace(MOBILE_CANDIDATE, (candidate) => {
    maskedCount += 1;
    return mask(normalise(candidate));
  });
  return { body, maskedCount };
}

export function containsPhoneNumber(text: string): boolean {
  MOBILE_CANDIDATE.lastIndex = 0;
  const found = MOBILE_CANDIDATE.test(text);
  MOBILE_CANDIDATE.lastIndex = 0;
  return found;
}
