import { describe, expect, it } from 'vitest';
import {
  buildQuery,
  isPublic,
  matchRoute,
  parsePath,
  resolveRedirect,
  ROUTES,
} from '../src/lib/router.js';

describe('router (E9-03)', () => {
  it('maps every screen path to its route name', () => {
    expect(matchRoute('/market')?.name).toBe('market');
    expect(matchRoute('/market/abc')?.name).toBe('order');
    expect(matchRoute('/market/abc')?.params['id']).toBe('abc');
    expect(matchRoute('/new')?.name).toBe('create');
    expect(matchRoute('/orders')?.name).toBe('orders');
    expect(matchRoute('/trade/r1')?.params).toEqual({ id: 'r1' });
    expect(matchRoute('/chat')?.params).toEqual({});
    expect(matchRoute('/chat/c1')?.params).toEqual({ id: 'c1' });
    expect(matchRoute('/notifications')?.name).toBe('notifications');
    expect(matchRoute('/profile')?.name).toBe('profile');
    expect(matchRoute('/plans')?.name).toBe('plans');
    expect(matchRoute('/login')?.name).toBe('login');
    expect(matchRoute('/style-guide')?.name).toBe('styleGuide');
  });

  it('keeps the bottom-bar deep links working', () => {
    expect(matchRoute('/search')?.name).toBe('market');
    expect(matchRoute('/orders/new')?.name).toBe('create');
  });

  it('treats the root and trailing slashes as the market', () => {
    expect(matchRoute('/')?.name).toBe('market');
    expect(matchRoute('/market/')?.name).toBe('market');
    expect(matchRoute('')?.name).toBe('market');
  });

  it('returns null for unknown paths so the shell can show not-found', () => {
    expect(matchRoute('/nope')).toBeNull();
    expect(matchRoute('/market/a/b')).toBeNull();
  });

  it('parses the query string alongside the path', () => {
    const parsed = parsePath('/market?side=SELL&tier=T1500');
    expect(parsed.path).toBe('/market');
    expect(parsed.query).toEqual({ side: 'SELL', tier: 'T1500' });
    expect(matchRoute('/market?side=SELL')?.query['side']).toBe('SELL');
  });

  it('only lets the login and style guide through without a session', () => {
    expect(isPublic('login')).toBe(true);
    expect(isPublic('styleGuide')).toBe(true);
    expect(isPublic('market')).toBe(false);
    expect(isPublic('trade')).toBe(false);
  });

  it('builds a query string without empty values', () => {
    expect(buildQuery({ a: 1, b: undefined, c: '', d: 'x' })).toBe('?a=1&d=x');
    expect(buildQuery({})).toBe('');
  });

  it('sends the user back to the screen they asked for after login', () => {
    expect(resolveRedirect(matchRoute('/trade/r1'))).toBe('/trade/r1');
    expect(resolveRedirect(matchRoute('/market/o1'))).toBe('/market/o1');
    expect(resolveRedirect(matchRoute('/login'))).toBe('/market');
    expect(resolveRedirect(null)).toBe('/market');
  });

  it('declares every route exactly once with a unique pattern', () => {
    const patterns = ROUTES.map((route) => route.pattern.source);
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});
