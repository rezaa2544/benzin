import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const tokensCss = readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8');

type Rgb = [number, number, number];

function block(selector: string): string {
  const start = tokensCss.indexOf(selector);
  if (start === -1) throw new Error(`missing ${selector}`);
  return tokensCss.slice(start, tokensCss.indexOf('}', start));
}

function colours(selector: string): Map<string, Rgb> {
  const found = new Map<string, Rgb>();
  for (const match of block(selector).matchAll(
    /--([\w-]+):\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3});/g,
  )) {
    found.set(match[1]!, [Number(match[2]), Number(match[3]), Number(match[4])]);
  }
  return found;
}

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const light = colours(':root');
const dark = colours("[data-theme='dark']");

describe('design tokens (E9-01)', () => {
  it('defines every colour in both themes, so dark mode cannot miss a token', () => {
    expect(light.size).toBeGreaterThan(18);
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort());
  });

  it('keeps body text at AAA contrast in light mode', () => {
    expect(contrast(light.get('ink')!, light.get('bg')!)).toBeGreaterThan(10);
    expect(contrast(light.get('ink')!, light.get('surface')!)).toBeGreaterThan(10);
  });

  it('keeps muted text and button labels above AA in both themes', () => {
    expect(contrast(light.get('muted')!, light.get('bg')!)).toBeGreaterThan(4.5);
    expect(contrast(light.get('brand-ink')!, light.get('brand')!)).toBeGreaterThan(4.5);
    expect(contrast(dark.get('ink')!, dark.get('bg')!)).toBeGreaterThan(10);
    expect(contrast(dark.get('muted')!, dark.get('bg')!)).toBeGreaterThan(4.5);
    expect(contrast(dark.get('brand-ink')!, dark.get('brand')!)).toBeGreaterThan(4.5);
    expect(contrast(dark.get('danger')!, dark.get('surface')!)).toBeGreaterThan(4.5);
  });

  it('exposes the spacing, radius, motion and safe-area tokens the shell relies on', () => {
    for (const token of [
      '--space-1',
      '--space-7',
      '--radius-card',
      '--radius-sheet',
      '--shadow-card',
      '--dur-fast',
      '--tap-min',
      '--phone-max',
      '--safe-bottom',
      '--nav-height',
    ]) {
      expect(tokensCss).toContain(`${token}:`);
    }
    expect(tokensCss).toContain('--tap-min: 44px');
  });

  it('keeps components free of raw colours and physical left/right rules', () => {
    const dir = join(ROOT, 'src/components');
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.tsx'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source, `${file} hard-codes a colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, `${file} uses a physical side rule`).not.toMatch(
        /\b(?:margin|padding)-(?:left|right)\b/,
      );
      expect(source, `${file} uses a latin-only font`).not.toMatch(/font-\[\s*['"]?(?!Vazir)/);
    }
  });
});
