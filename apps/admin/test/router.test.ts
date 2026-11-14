import { describe, expect, it } from 'vitest';
import { buildHash, matchRoute, parseHash, resolveRoute } from '../src/lib/router.js';

describe('admin hash router (E8-01)', () => {
  it('parses path and query', () => {
    expect(parseHash('#/users?q=0912&role=ADMIN')).toEqual({
      path: '/users',
      query: { q: '0912', role: 'ADMIN' },
    });
    expect(parseHash('')).toEqual({ path: '/', query: {} });
  });

  it('matches detail routes with params', () => {
    expect(matchRoute('#/orders/abc-1')).toEqual({
      page: 'orders',
      params: { id: 'abc-1' },
      query: {},
    });
    expect(matchRoute('#/dashboard')?.page).toBe('dashboard');
    expect(matchRoute('#/nope')).toBeNull();
  });

  it('refuses pages a role cannot open and lands on its default', () => {
    expect(resolveRoute('#/payments', 'SUPPORT')?.page).toBe('dashboard');
    expect(resolveRoute('#/payments', 'ADMIN')?.page).toBe('payments');
    expect(resolveRoute('#/users', 'USER')).toBeNull();
  });

  it('builds links back from state', () => {
    expect(buildHash('users', { id: 'u1' })).toBe('#/users/u1');
    expect(buildHash('audit', { query: { entity: 'zone', offset: 20 } })).toBe(
      '#/audit?entity=zone&offset=20',
    );
    expect(buildHash('users', { query: { q: '' } })).toBe('#/users');
  });
});
