import type { UserRole } from '@benzin/shared';

/**
 * Session storage for the panel (task E8-01). `localStorage` is unavailable in tests and
 * in some hardened browsers, so a memory fallback keeps the app functional either way.
 */

export const SESSION_KEY = 'benzin.admin.session';

export interface SessionUser {
  id: string;
  phone: string;
  displayName: string | null;
  role: UserRole;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

export const defaultStore = (): KeyValueStore => {
  if (typeof localStorage !== 'undefined') return localStorage;
  return new MemoryStore();
};

export const readSession = (store: KeyValueStore = defaultStore()): Session | null => {
  const raw = store.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed.accessToken || !parsed.user?.role) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? '',
      user: {
        id: parsed.user.id ?? '',
        phone: parsed.user.phone ?? '',
        displayName: parsed.user.displayName ?? null,
        role: parsed.user.role,
      },
    };
  } catch {
    return null;
  }
};

export const writeSession = (session: Session, store: KeyValueStore = defaultStore()): void => {
  store.setItem(SESSION_KEY, JSON.stringify(session));
};

export const clearSession = (store: KeyValueStore = defaultStore()): void => {
  store.removeItem(SESSION_KEY);
};
