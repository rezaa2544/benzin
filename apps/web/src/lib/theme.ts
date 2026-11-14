export const THEME_KEY = 'benzin.web.theme';
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedTheme = 'light' | 'dark';

/** Minimal storage surface so the theme logic is testable without a DOM. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

/** `system` follows the OS; anything unknown falls back to light, never to a blank theme. */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

export function readTheme(storage: ThemeStorage | undefined): ThemeMode {
  try {
    const stored = storage?.getItem(THEME_KEY) ?? null;
    return isThemeMode(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function writeTheme(storage: ThemeStorage | undefined, mode: ThemeMode): void {
  try {
    storage?.setItem(THEME_KEY, mode);
  } catch {
    /* private mode or quota — the UI keeps the in-memory choice */
  }
}

/** light → dark → system → light, the order the header toggle walks. */
export function nextTheme(mode: ThemeMode): ThemeMode {
  const index = THEME_MODES.indexOf(mode);
  return THEME_MODES[(index + 1) % THEME_MODES.length] as ThemeMode;
}

export function themeLabelKey(mode: ThemeMode): string {
  return mode === 'light'
    ? 'nav.themeLight'
    : mode === 'dark'
      ? 'nav.themeDark'
      : 'nav.themeSystem';
}

/** Applies the resolved theme to <html> and keeps the browser chrome in sync. */
export function applyTheme(
  theme: ResolvedTheme,
  root: {
    setAttribute(name: string, value: string): void;
    querySelector(selector: string): { setAttribute(name: string, value: string): void } | null;
  },
  background: string,
): void {
  root.setAttribute('data-theme', theme);
  root.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  root.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
}
