export interface RouteMatch {
  name: RouteName;
  params: Record<string, string>;
  query: Record<string, string>;
}

export const ROUTES = [
  { name: 'market', pattern: /^\/market$/ },
  // `/search` is the bottom-nav entry for the same list; the filters are the search.
  { name: 'market', pattern: /^\/search$/ },
  { name: 'order', pattern: /^\/market\/([^/]+)$/, param: 'id' },
  { name: 'create', pattern: /^\/new$/ },
  // Legacy deep link kept working for the bottom bar shipped in E9-02.
  { name: 'create', pattern: /^\/orders\/new$/ },
  { name: 'orders', pattern: /^\/orders$/ },
  { name: 'trade', pattern: /^\/trade\/([^/]+)$/, param: 'id' },
  { name: 'chat', pattern: /^\/chat$/ },
  { name: 'chat', pattern: /^\/chat\/([^/]+)$/, param: 'id' },
  { name: 'notifications', pattern: /^\/notifications$/ },
  { name: 'profile', pattern: /^\/profile$/ },
  { name: 'plans', pattern: /^\/plans$/ },
  { name: 'login', pattern: /^\/login$/ },
  // The design-system review screen from E9-02 stays reachable for the approval gate.
  { name: 'styleGuide', pattern: /^\/style-guide$/ },
] as const;

export type RouteName = (typeof ROUTES)[number]['name'];

/** Public routes stay reachable without a session; everything else needs one. */
export const PUBLIC_ROUTES: readonly RouteName[] = ['login', 'styleGuide'];

export function parsePath(raw: string): { path: string; query: Record<string, string> } {
  const [path, search = ''] = raw.split('?');
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) query[key] = value;
  return { path: path || '/', query };
}

export function matchRoute(raw: string): RouteMatch | null {
  const { path, query } = parsePath(raw);
  const normalised = path === '/' ? '/market' : path.replace(/\/+$/, '') || '/market';
  for (const route of ROUTES) {
    const found = route.pattern.exec(normalised);
    if (!found) continue;
    const param = 'param' in route ? route.param : undefined;
    return {
      name: route.name,
      params: param && found[1] ? { [param]: decodeURIComponent(found[1]) } : {},
      query,
    };
  }
  return null;
}

/** Where to land after login: the requested path, or the market. */
export function resolveRedirect(match: RouteMatch | null): string {
  if (!match) return '/market';
  if (match.name === 'login') return '/market';
  const path = match.params['id']
    ? `/${match.name === 'order' ? 'market' : match.name}/${match.params['id']}`
    : `/${match.name}`;
  return path;
}

export function buildQuery(query: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function isPublic(name: RouteName): boolean {
  return PUBLIC_ROUTES.includes(name);
}

/** Same-origin navigation that keeps the back button working. */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
