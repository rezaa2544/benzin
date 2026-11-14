import { describe, expect, it, vi } from 'vitest';
import {
  THEME_KEY,
  applyTheme,
  nextTheme,
  readTheme,
  resolveTheme,
  themeLabelKey,
  writeTheme,
} from '../src/lib/theme.js';

const storageWith = (value: string | null) => ({
  getItem: vi.fn(() => value),
  setItem: vi.fn(),
});

describe('theme (E9-01)', () => {
  it('follows the OS when the mode is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('falls back to system for a missing or corrupted stored value', () => {
    expect(readTheme(undefined)).toBe('system');
    expect(readTheme(storageWith(null))).toBe('system');
    expect(readTheme(storageWith('sepia'))).toBe('system');
    expect(readTheme(storageWith('dark'))).toBe('dark');
  });

  it('cycles light → dark → system and back', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
    expect(nextTheme('system')).toBe('light');
  });

  it('persists the choice under a namespaced key and survives a throwing storage', () => {
    const storage = storageWith(null);
    writeTheme(storage, 'dark');
    expect(storage.setItem).toHaveBeenCalledWith(THEME_KEY, 'dark');
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readTheme(broken)).toBe('system');
    expect(() => writeTheme(broken, 'light')).not.toThrow();
  });

  it('writes data-theme and the browser chrome meta tags', () => {
    const metas: Record<string, string> = {};
    const root = {
      setAttribute: vi.fn(),
      querySelector: (selector: string) => ({
        setAttribute: (name: string, value: string) => {
          metas[selector] = `${name}=${value}`;
        },
      }),
    };
    applyTheme('dark', root, '#0c100e');
    expect(root.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    expect(metas['meta[name="color-scheme"]']).toBe('content=dark');
    expect(metas['meta[name="theme-color"]']).toBe('content=#0c100e');
  });

  it('labels every mode for the toggle', () => {
    expect(themeLabelKey('light')).toBe('nav.themeLight');
    expect(themeLabelKey('dark')).toBe('nav.themeDark');
    expect(themeLabelKey('system')).toBe('nav.themeSystem');
  });
});
