import fa from '../i18n/fa.json';

export type Dictionary = typeof fa;

export const dictionary: Dictionary = fa;

/**
 * Resolves a dotted dictionary path. Missing keys fall back to the path itself so a typo
 * shows up in review as `styleGuide.colors` instead of an empty label, and callers can
 * assert on it in tests.
 */
export function t(path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      dictionary,
    );
  return typeof value === 'string' ? value : path;
}

/** Replaces `{name}` placeholders in dictionary strings. */
export function tf(path: string, params: Record<string, string | number>): string {
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    t(path),
  );
}

/** Every leaf path of a dictionary — used to prove the two apps keep the same keys. */
export function keysOf(node: unknown, prefix = ''): string[] {
  if (!node || typeof node !== 'object') return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    keysOf(value, prefix ? `${prefix}.${key}` : key),
  );
}
