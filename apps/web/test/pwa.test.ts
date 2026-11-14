import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  MANIFEST_PATH,
  SERVICE_WORKER_PATH,
  isStandalone,
  readOnline,
  registerServiceWorker,
  shouldRegisterServiceWorker,
  subscribeOnline,
} from '../src/lib/pwa.js';

const at = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path: string): string => readFileSync(at(path), 'utf8');

/** `--brand: 10 110 68;` → `#0a6e44` so the manifest and the CSS can be compared. */
function tokenHex(css: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`).exec(css);
  if (!match) throw new Error(`token --${name} not found`);
  const hex = match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0'));
  return `#${hex.join('')}`;
}

interface PngHeader {
  width: number;
  height: number;
}

function pngHeader(path: string): PngHeader {
  const bytes = readFileSync(at(path));
  expect(bytes.subarray(1, 4).toString('ascii'), `${path} is a PNG`).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('web app manifest (E9-15)', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
    name: string;
    short_name: string;
    lang: string;
    dir: string;
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };
  const tokens = read('src/styles/tokens.css');

  it('installs as an RTL Persian standalone app rooted at /', () => {
    expect(manifest.name).toContain('بنزین');
    expect(manifest.short_name).toBe('بنزین');
    expect(manifest.lang).toBe('fa');
    expect(manifest.dir).toBe('rtl');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('paints the splash screen with the real design tokens, not a copy', () => {
    expect(manifest.theme_color).toBe(tokenHex(tokens, 'brand'));
    expect(manifest.background_color).toBe(tokenHex(tokens, 'bg'));
  });

  it('ships a 192 and a 512 any icon plus a maskable one, all real PNGs of the declared size', () => {
    const purposes = manifest.icons.map((icon) => icon.purpose ?? 'any');
    expect(purposes).toContain('any');
    expect(purposes).toContain('maskable');

    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      const file = `public${icon.src}`;
      expect(existsSync(at(file)), `${file} exists`).toBe(true);
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngHeader(file)).toEqual({ width, height });
      expect(statSync(at(file)).size).toBeGreaterThan(500);
    }

    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('has the iOS icon Apple asks for, because Safari ignores manifest icons', () => {
    expect(pngHeader('public/icons/apple-touch-icon-180.png')).toEqual({ width: 180, height: 180 });
  });
});

describe('service worker (E9-15)', () => {
  const source = read('public/sw.js');

  const precache = (): string[] => {
    const match = /const PRECACHE = \[([\s\S]*?)\];/.exec(source);
    if (!match?.[1]) throw new Error('PRECACHE array not found');
    // The array mixes literals with the SHELL / OFFLINE_URL constants; resolve them instead of
    // loosening the rule that every precached path must exist on disk.
    const constants: Record<string, string> = { SHELL: '/', OFFLINE_URL: '/offline.html' };
    return [...match[1].matchAll(/'([^']+)'|\b(SHELL|OFFLINE_URL)\b/g)].map((entry) => {
      const resolved = entry[1] ?? constants[entry[2] ?? ''];
      if (!resolved) throw new Error(`unresolved precache entry: ${entry[0]}`);
      return resolved;
    });
  };

  it('precaches a shell, the offline card and the manifest — and every path exists on disk', () => {
    const paths = precache();
    expect(paths).toContain('/');
    expect(paths).toContain('/offline.html');
    expect(paths).toContain('/manifest.webmanifest');

    for (const path of paths) {
      const file = path === '/' ? 'index.html' : `public${path}`;
      expect(existsSync(at(file)), `${file} exists`).toBe(true);
    }
  });

  it('never caches the API and is versioned so an update can drop the old cache', () => {
    expect(source).toContain("const API_PREFIX = '/v1'");
    expect(source).toMatch(/isApi\(url\)\) return;/);
    expect(source).toMatch(/const VERSION = 'v\d+'/);
    expect(source).toContain('caches.delete');
    expect(source).toContain('skipWaiting');
  });
});

describe('index.html wiring (E9-15)', () => {
  const html = read('index.html');
  const tokens = read('src/styles/tokens.css');

  it('links the manifest, the apple icon and the SVG favicon', () => {
    expect(html).toContain(`rel="manifest" href="${MANIFEST_PATH}"`);
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('icons/apple-touch-icon-180.png');
    expect(html).toContain('rel="icon" href="/icons/favicon.svg"');
  });

  it('opts iOS into standalone mode and keeps the status bar readable', () => {
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style" content="default"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="بنزین"');
    expect(html).toContain('viewport-fit=cover');
  });

  it('uses the brand token for the browser chrome', () => {
    expect(html).toContain(`name="theme-color" content="${tokenHex(tokens, 'brand')}"`);
  });

  it('registers the worker at the path the worker actually lives at', () => {
    expect(SERVICE_WORKER_PATH).toBe('/sw.js');
    expect(existsSync(at('public/sw.js'))).toBe(true);
  });
});

describe('pwa helpers', () => {
  const media = (matches: boolean) => ({ matchMedia: () => ({ matches }) });

  it('detects the installed app on iOS and on standards-based browsers', () => {
    expect(isStandalone({ ...media(false), navigatorStandalone: true })).toBe(true);
    expect(isStandalone(media(true))).toBe(true);
    expect(isStandalone(media(false))).toBe(false);
  });

  it('survives a browser that throws on matchMedia', () => {
    const broken = {
      matchMedia: () => {
        throw new Error('not supported');
      },
    };
    expect(isStandalone(broken)).toBe(false);
  });

  it('registers only in production and only on a secure origin', () => {
    const base = {
      serviceWorker: true,
      production: true,
      protocol: 'https:',
      hostname: 'benzin.ir',
    };
    expect(shouldRegisterServiceWorker(base)).toBe(true);
    expect(shouldRegisterServiceWorker({ ...base, production: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...base, serviceWorker: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...base, protocol: 'http:' })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...base, protocol: 'http:', hostname: 'localhost' })).toBe(
      true,
    );
    expect(shouldRegisterServiceWorker({ ...base, protocol: 'http:', hostname: '127.0.0.1' })).toBe(
      true,
    );
  });

  it('registers with the root scope and swallows failures', async () => {
    const register = vi.fn(async () => ({}));
    const env = {
      serviceWorker: true,
      production: true,
      protocol: 'https:',
      hostname: 'benzin.ir',
    };
    await expect(registerServiceWorker(env, { register })).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });

    const onError = vi.fn();
    const failing = {
      register: vi.fn(async () => {
        throw new Error('denied');
      }),
    };
    await expect(registerServiceWorker(env, failing, onError)).resolves.toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    await expect(registerServiceWorker(env, undefined)).resolves.toBe(false);
  });

  it('tracks online/offline flips and unsubscribes cleanly', () => {
    const listeners = new Map<string, () => void>();
    const probe = {
      navigator: { onLine: false },
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    expect(readOnline(probe)).toBe(false);
    const onChange = vi.fn();
    const unsubscribe = subscribeOnline(probe, onChange);
    listeners.get('online')?.();
    listeners.get('offline')?.();
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});
