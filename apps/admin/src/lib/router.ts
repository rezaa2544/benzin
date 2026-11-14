import { canAccess, defaultPageFor, type PageId } from './permissions.js';
import type { UserRole } from '@benzin/shared';

/**
 * Hash routing keeps the SPA deployable as static files behind Caddy with no rewrite
 * rules (task E8-01). Paths are stable strings so tests can assert them directly.
 */

export interface RouteMatch {
  page: PageId;
  params: Record<string, string>;
  query: Record<string, string>;
}

const ROUTES: { pattern: string; page: PageId }[] = [
  { pattern: '/', page: 'dashboard' },
  { pattern: '/dashboard', page: 'dashboard' },
  { pattern: '/users', page: 'users' },
  { pattern: '/users/:id', page: 'users' },
  { pattern: '/orders', page: 'orders' },
  { pattern: '/orders/:id', page: 'orders' },
  { pattern: '/payments', page: 'payments' },
  { pattern: '/subscriptions', page: 'subscriptions' },
  { pattern: '/settings', page: 'settings' },
  { pattern: '/sms', page: 'sms' },
  { pattern: '/zones', page: 'zones' },
  { pattern: '/audit', page: 'audit' },
  { pattern: '/status', page: 'status' },
];

export const parseHash = (hash: string): { path: string; query: Record<string, string> } => {
  const clean = hash.replace(/^#/, '');
  const [path = '/', search = ''] = clean.split('?');
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search).entries()) query[key] = value;
  return { path: path === '' ? '/' : path, query };
};

export const matchRoute = (hash: string): RouteMatch | null => {
  const { path, query } = parseHash(hash);
  for (const route of ROUTES) {
    const patternParts = route.pattern.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);
    if (patternParts.length !== pathParts.length) continue;
    const params: Record<string, string> = {};
    const matched = patternParts.every((part, index) => {
      const actual = pathParts[index] ?? '';
      if (part.startsWith(':')) {
        params[part.slice(1)] = actual;
        return actual.length > 0;
      }
      return part === actual;
    });
    if (matched) return { page: route.page, params, query };
  }
  return null;
};

/** Unknown paths fall back to the role's landing page; forbidden ones are refused. */
export const resolveRoute = (hash: string, role: UserRole): RouteMatch | null => {
  const match = matchRoute(hash);
  if (match && canAccess(role, match.page)) return match;
  const fallback = defaultPageFor(role);
  return fallback ? { page: fallback, params: {}, query: {} } : null;
};

export const buildHash = (
  page: PageId,
  options: { id?: string; query?: Record<string, string | number | undefined> } = {},
): string => {
  const base = page === 'dashboard' ? '/dashboard' : `/${page}`;
  const path = options.id ? `${base}/${options.id}` : base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `#${path}${search ? `?${search}` : ''}`;
};
