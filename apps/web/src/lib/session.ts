import type { Tokens } from './api.js';
import type { PublicUser } from './types.js';

export const SESSION_KEY = 'benzin.web.session';

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
  deviceId: string;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** Falls back to memory when storage is unavailable (private mode, quota, SSR). */
export function resolveStore(candidate?: KeyValueStore): KeyValueStore {
  if (candidate) return candidate;
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__benzin__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return memoryStore();
}

export function readSession(store: KeyValueStore): Session | null {
  const raw = store.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user?.id) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      user: parsed.user,
      deviceId: parsed.deviceId ?? 'web',
    };
  } catch {
    return null;
  }
}

export function writeSession(store: KeyValueStore, session: Session): void {
  store.setItem(SESSION_KEY, JSON.stringify(session));
}

export function patchTokens(store: KeyValueStore, tokens: Tokens): Session | null {
  const current = readSession(store);
  if (!current) return null;
  const next: Session = { ...current, ...tokens };
  writeSession(store, next);
  return next;
}

export function clearSession(store: KeyValueStore): void {
  store.removeItem(SESSION_KEY);
}
