/**
 * PWA plumbing (task E9-15). Everything here is a pure function over a tiny probe interface so the
 * iOS-specific corners — the vendor `navigator.standalone` flag and the "no service worker on plain
 * HTTP" rule — are unit-testable without a browser.
 */

export const MANIFEST_PATH = '/manifest.webmanifest';
export const SERVICE_WORKER_PATH = '/sw.js';

export interface StandaloneProbe {
  matchMedia(query: string): { matches: boolean };
  /** iOS Safari in "add to home screen" mode: neither `display-mode` nor `fullscreen` is reliable. */
  navigatorStandalone?: boolean;
}

/** True when the app runs as an installed icon rather than inside a browser tab. */
export function isStandalone(probe: StandaloneProbe): boolean {
  if (probe.navigatorStandalone) return true;
  try {
    return probe.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

export interface RegistrationEnv {
  /** `'serviceWorker' in navigator` */
  serviceWorker: boolean;
  /** `import.meta.env.PROD` — a dev server would cache half-built modules. */
  production: boolean;
  protocol: string;
  hostname: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Service workers need a secure context. `http://localhost` is the one exception every browser
 * grants, so development works; anything else over plain HTTP is refused instead of throwing
 * an unhandled rejection in the console.
 */
export function shouldRegisterServiceWorker(env: RegistrationEnv): boolean {
  if (!env.serviceWorker || !env.production) return false;
  if (env.protocol === 'https:') return true;
  return env.protocol === 'http:' && LOCAL_HOSTS.has(env.hostname);
}

export interface ServiceWorkerContainerLike {
  register(scriptUrl: string, options?: { scope?: string }): Promise<unknown>;
}

/**
 * Registers the worker and never rejects: a failed registration (private mode, storage disabled,
 * unsupported WebView) must not take the app down with it.
 */
export async function registerServiceWorker(
  env: RegistrationEnv,
  container: ServiceWorkerContainerLike | undefined,
  onError: (error: unknown) => void = () => {},
): Promise<boolean> {
  if (!container || !shouldRegisterServiceWorker(env)) return false;
  try {
    await container.register(SERVICE_WORKER_PATH, { scope: '/' });
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}

export interface OnlineProbe {
  navigator: { onLine: boolean };
  addEventListener(type: 'online' | 'offline', listener: () => void): void;
  removeEventListener(type: 'online' | 'offline', listener: () => void): void;
}

/** `navigator.onLine` is optimistic (it only knows about a network, not about reachability), but
 * it is the only signal a browser gives us before a request actually fails. */
export function readOnline(probe: Pick<OnlineProbe, 'navigator'>): boolean {
  return probe.navigator.onLine !== false;
}

/** Subscribes to network flips and returns the unsubscribe function. */
export function subscribeOnline(probe: OnlineProbe, listener: () => void): () => void {
  probe.addEventListener('online', listener);
  probe.addEventListener('offline', listener);
  return () => {
    probe.removeEventListener('online', listener);
    probe.removeEventListener('offline', listener);
  };
}
