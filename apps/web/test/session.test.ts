import { describe, expect, it } from 'vitest';
import {
  clearSession,
  patchTokens,
  readSession,
  resolveStore,
  SESSION_KEY,
  writeSession,
  type KeyValueStore,
  type Session,
} from '../src/lib/session.js';

const memory = (): KeyValueStore => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
};

const session: Session = {
  accessToken: 'a1',
  refreshToken: 'r1',
  user: { id: 'u1', phone: '09120000000', displayName: null, role: 'USER' },
  deviceId: 'web-1',
};

describe('session store (E9-03)', () => {
  it('round-trips a session under the documented key', () => {
    const store = memory();
    writeSession(store, session);
    expect(store.getItem(SESSION_KEY)).toContain('a1');
    expect(readSession(store)).toEqual(session);
  });

  it('returns null for an empty, broken or partial payload', () => {
    const store = memory();
    expect(readSession(store)).toBeNull();
    store.setItem(SESSION_KEY, '{not json');
    expect(readSession(store)).toBeNull();
    store.setItem(SESSION_KEY, JSON.stringify({ accessToken: 'a1' }));
    expect(readSession(store)).toBeNull();
  });

  it('rotates tokens without losing the user', () => {
    const store = memory();
    writeSession(store, session);
    const next = patchTokens(store, { accessToken: 'a2', refreshToken: 'r2' });
    expect(next?.user.id).toBe('u1');
    expect(readSession(store)?.accessToken).toBe('a2');
    expect(patchTokens(memory(), { accessToken: 'x', refreshToken: 'y' })).toBeNull();
  });

  it('clears the session on logout', () => {
    const store = memory();
    writeSession(store, session);
    clearSession(store);
    expect(readSession(store)).toBeNull();
  });

  it('falls back to a usable store when storage is unavailable', () => {
    const store = resolveStore();
    expect(() => store.setItem('probe', '1')).not.toThrow();
    expect(store.getItem('probe')).toBe('1');
    store.removeItem('probe');
    expect(store.getItem('probe')).toBeNull();
  });

  it('defaults the device id instead of dropping a legacy session', () => {
    const store = memory();
    store.setItem(SESSION_KEY, JSON.stringify({ ...session, deviceId: undefined }));
    expect(readSession(store)?.deviceId).toBe('web');
  });
});
