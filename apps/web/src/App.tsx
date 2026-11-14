import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from './lib/api.js';
import {
  clearSession,
  patchTokens,
  readSession,
  resolveStore,
  writeSession,
  type Session,
} from './lib/session.js';
import { buildQuery, isPublic, matchRoute, navigate, type RouteMatch } from './lib/router.js';
import { filtersFromQuery, type MarketFilters } from './lib/market.js';
import {
  applyTheme,
  nextTheme,
  readTheme,
  resolveTheme,
  writeTheme,
  type ThemeMode,
} from './lib/theme.js';
import { t } from './lib/i18n.js';
import type { AuthResult, MetaConfig, ZoneView } from './lib/types.js';
import { AppShell } from './components/AppShell.js';
import type { NavKey } from './components/BottomNav.js';
import { StyleGuidePage } from './pages/StyleGuidePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { MarketPage } from './pages/MarketPage.js';
import { OrderDetailPage } from './pages/OrderDetailPage.js';
import { CreateOrderPage } from './pages/CreateOrderPage.js';
import { MyOrdersPage } from './pages/MyOrdersPage.js';
import { TradePage } from './pages/TradePage.js';
import { ChatPage } from './pages/ChatPage.js';
import { NotificationsPage } from './pages/NotificationsPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { PlansPage } from './pages/PlansPage.js';
import { Notice } from './pages/parts.js';

const MEDIA = '(prefers-color-scheme: dark)';

const currentRoute = (): RouteMatch | null =>
  typeof window === 'undefined'
    ? null
    : matchRoute(`${window.location.pathname}${window.location.search}`);

const NAV_OF_ROUTE: Partial<Record<RouteMatch['name'], NavKey>> = {
  market: 'market',
  order: 'market',
  create: 'create',
  orders: 'orders',
  profile: 'profile',
  plans: 'profile',
};

/**
 * App root (E9-03). Owns the session, the api client and the URL: every screen receives
 * data through props and navigates with `navigate`, so the router here is the only place
 * that reads `location`.
 */
export function App(): JSX.Element {
  const store = useMemo(() => resolveStore(), []);
  const [session, setSession] = useState<Session | null>(() => readSession(store));
  const [route, setRoute] = useState<RouteMatch | null>(() => currentRoute());
  const [config, setConfig] = useState<MetaConfig | null>(null);
  const [zones, setZones] = useState<ZoneView[]>([]);
  const [unread, setUnread] = useState(0);
  const [mode, setMode] = useState<ThemeMode>(() =>
    readTheme(typeof window === 'undefined' ? undefined : window.localStorage),
  );
  const [prefersDark, setPrefersDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MEDIA).matches,
  );
  const storeRef = useRef(store);
  storeRef.current = store;

  const logout = useCallback(() => {
    clearSession(storeRef.current);
    setSession(null);
    setUnread(0);
  }, []);

  const api = useMemo(
    () =>
      new ApiClient({
        getAccessToken: () => readSession(storeRef.current)?.accessToken ?? null,
        getRefreshToken: () => readSession(storeRef.current)?.refreshToken ?? null,
        onTokens: (tokens) => {
          const next = patchTokens(storeRef.current, tokens);
          if (next) setSession(next);
        },
        onLogout: logout,
      }),
    [logout],
  );

  // ---------------------------------------------------------------- theme
  useEffect(() => {
    const media = window.matchMedia(MEDIA);
    const onChange = (event: MediaQueryListEvent): void => setPrefersDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const resolved = resolveTheme(mode, prefersDark);
    applyTheme(resolved, document.documentElement, resolved === 'dark' ? '#0c100e' : '#0a6e44');
  }, [mode, prefersDark]);

  const toggleTheme = useCallback(() => {
    setMode((current) => {
      const next = nextTheme(current);
      writeTheme(window.localStorage, next);
      return next;
    });
  }, []);

  // -------------------------------------------------------------- routing
  useEffect(() => {
    const onPop = (): void => setRoute(currentRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Bounce unauthenticated deep links to /login, keeping the destination.
  useEffect(() => {
    if (!route) return;
    if (session || isPublic(route.name)) return;
    const path = `${window.location.pathname}${window.location.search}`;
    navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true });
  }, [route, session]);

  // -------------------------------------------------------------- bootstrap
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void api
      .get<MetaConfig>('/v1/meta/config')
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .catch(() => undefined);
    void api
      .get<{ items: ZoneView[] }>('/v1/zones')
      .then((result) => {
        if (!cancelled) setZones(result.items);
      })
      .catch(() => undefined);
    void api
      .get<{ unreadCount: number }>('/v1/notifications/unread-count')
      .then((result) => {
        if (!cancelled) setUnread(result.unreadCount);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, session]);

  const onAuthenticated = useCallback(
    (auth: AuthResult) => {
      const next: Session = {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        user: auth.user,
        deviceId: auth.deviceId,
      };
      writeSession(storeRef.current, next);
      setSession(next);
      const requested = route?.query['next'];
      const target = requested ? decodeURIComponent(requested) : '/market';
      navigate(target.startsWith('/') ? target : '/market', { replace: true });
    },
    [route],
  );

  // ---------------------------------------------------------------- render
  if (!route) {
    return (
      <AppShell theme={mode} onToggleTheme={toggleTheme}>
        <Notice tone="error">{t('errors.NOT_FOUND')}</Notice>
      </AppShell>
    );
  }

  if (route.name === 'login') {
    return (
      <LoginPage
        api={api}
        config={config}
        onAuthenticated={onAuthenticated}
        reason={route.query['expired'] ? t('errors.TOKEN_EXPIRED') : undefined}
      />
    );
  }

  if (!session) return <LoginPage api={api} config={config} onAuthenticated={onAuthenticated} />;

  const filters: MarketFilters = filtersFromQuery(route.query);
  // Filters are URL state: writing them goes through the router, so back/forward work.
  const onFilters = (next: MarketFilters): void => {
    const path = window.location.pathname === '/search' ? '/search' : '/market';
    navigate(
      `${path}${buildQuery({
        zoneId: next.zoneId,
        side: next.side,
        tier: next.tier,
        sort: next.sort,
      })}`,
      { replace: true },
    );
  };

  const body = renderRoute(route, session);
  return (
    <AppShell
      active={NAV_OF_ROUTE[route.name]}
      theme={mode}
      onToggleTheme={toggleTheme}
      hideNav={route.name === 'chat'}
      onNavigate={(_key, href) => navigate(href)}
      headerAction={
        unread > 0 ? (
          <button
            type="button"
            className="btn btn-ghost min-w-tap px-2 text-xs"
            onClick={() => navigate('/notifications')}
            aria-label={t('notifications.title')}
          >
            <span className="relative">
              🔔
              <span className="absolute -end-1 -top-1 h-2 w-2 rounded-pill bg-danger" />
            </span>
          </button>
        ) : undefined
      }
    >
      {body}
    </AppShell>
  );

  function renderRoute(route: RouteMatch, session: Session): JSX.Element {
    switch (route.name) {
      case 'market':
        return (
          <MarketPage
            api={api}
            config={config}
            zones={zones}
            filters={filters}
            onFilters={onFilters}
          />
        );
      case 'order':
        return <OrderDetailPage api={api} user={session.user} orderId={route.params['id'] ?? ''} />;
      case 'create':
        return <CreateOrderPage api={api} config={config} zones={zones} />;
      case 'orders':
        return <MyOrdersPage api={api} />;
      case 'trade':
        return (
          <TradePage
            api={api}
            user={session.user}
            config={config}
            reservationId={route.params['id'] ?? ''}
          />
        );
      case 'chat':
        return (
          <ChatPage
            api={api}
            user={session.user}
            config={config}
            conversationId={route.params['id']}
          />
        );
      case 'notifications':
        return <NotificationsPage api={api} onUnreadChange={setUnread} />;
      case 'profile':
        return <ProfilePage api={api} user={session.user} onLogout={logout} />;
      case 'plans':
        return <PlansPage api={api} />;
      case 'styleGuide':
        return <StyleGuidePage theme={mode} onToggleTheme={toggleTheme} />;
      default:
        return (
          <div>
            <Notice tone="error">{t('errors.NOT_FOUND')}</Notice>
            <button
              type="button"
              className="btn btn-primary w-full"
              onClick={() => navigate('/market')}
            >
              {t('nav.market')}
            </button>
          </div>
        );
    }
  }
}
