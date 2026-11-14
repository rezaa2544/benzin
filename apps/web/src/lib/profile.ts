export interface DisplayNameMessages {
  tooShort: string;
  tooLong: string;
  phoneLike: string;
}

export interface DisplayNameResult {
  /** What to send to `PATCH /v1/me`: `null` clears the name. */
  displayName: string | null;
  error: string | null;
}

/**
 * Client-side mirror of `updateProfileSchema` (task E1-05): 2…60 characters after trimming,
 * an empty field clears the name, and a phone-like string is refused so nobody can pass a
 * number off as their name before the owner accepts a trade.
 */
export function validateDisplayName(raw: string, messages: DisplayNameMessages): DisplayNameResult {
  const displayName = raw.trim();
  if (displayName === '') return { displayName: null, error: null };
  if (displayName.length < 2) return { displayName: null, error: messages.tooShort };
  if (displayName.length > 60) return { displayName: null, error: messages.tooLong };
  if (/^[\d\s+\-()]+$/.test(displayName)) {
    return { displayName: null, error: messages.phoneLike };
  }
  return { displayName, error: null };
}
