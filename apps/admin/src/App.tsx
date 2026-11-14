import { useEffect, useMemo, useState } from 'react';
import { ApiClient } from './lib/api.js';
import { resolveRoute } from './lib/router.js';
import { clearSession, readSession, writeSession, type Session } from './lib/session.js';
import { AppShell } from './components/AppShell.js';
import { Notice } from './components/ui.js';
import { AuditPage } from './pages/AuditPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { OrdersPage } from './pages/OrdersPage.js';
import { PaymentsPage } from './pages/PaymentsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { SmsPage } from './pages/SmsPage.js';
import { StatusPage } from './pages/StatusPage.js';
import { SubscriptionsPage } from './pages/SubscriptionsPage.js';
import { UsersPage } from './pages/UsersPage.js';
import { ZonesPage } from './pages/ZonesPage.js';
import fa from './i18n/fa.json';

/** Panel root: session, hash routing and the page switch (task E8-01). */
export function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [hash, setHash] = useState(() => window.location.hash || '#/dashboard');

  useEffect(() => {
    const onHashChange = (): void => setHash(window.location.hash || '#/dashboard');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const api = useMemo(
    () =>
      new ApiClient({
        getToken: () => session?.accessToken ?? null,
        onUnauthorized: () => {
          clearSession();
          setSession(null);
        },
      }),
    [session],
  );

  if (!session) {
    return (
      <LoginPage
        onLogin={(auth) => {
          const next: Session = {
            accessToken: auth.accessToken,
            refreshToken: auth.refreshToken,
            user: {
              id: auth.user.id,
              phone: auth.user.phone,
              displayName: auth.user.displayName,
              role: auth.user.role,
            },
          };
          writeSession(next);
          setSession(next);
          window.location.hash = '#/dashboard';
        }}
      />
    );
  }

  const route = resolveRoute(hash, session.user.role);
  if (!route) {
    return (
      <div className="p-6">
        <Notice tone="error">{fa.login.noAccess}</Notice>
      </div>
    );
  }

  const page = (() => {
    switch (route.page) {
      case 'dashboard':
        return <DashboardPage api={api} />;
      case 'users':
        return <UsersPage api={api} user={session.user} focusId={route.params['id']} />;
      case 'orders':
        return <OrdersPage api={api} focusId={route.params['id']} />;
      case 'payments':
        return <PaymentsPage api={api} />;
      case 'subscriptions':
        return <SubscriptionsPage api={api} />;
      case 'settings':
        return <SettingsPage api={api} />;
      case 'sms':
        return <SmsPage api={api} />;
      case 'zones':
        return <ZonesPage api={api} />;
      case 'audit':
        return <AuditPage api={api} />;
      case 'status':
        return <StatusPage api={api} />;
      default:
        return <Notice>{fa.app.empty}</Notice>;
    }
  })();

  return (
    <AppShell
      user={session.user}
      active={route.page}
      onLogout={() => {
        clearSession();
        setSession(null);
      }}
    >
      {page}
    </AppShell>
  );
}
