import type { ReactNode } from 'react';
import { canAccess, type PageId } from '../lib/permissions.js';
import { buildHash } from '../lib/router.js';
import type { SessionUser } from '../lib/session.js';
import fa from '../i18n/fa.json';

const NAV: { page: PageId; label: string }[] = [
  { page: 'dashboard', label: fa.nav.dashboard },
  { page: 'users', label: fa.nav.users },
  { page: 'orders', label: fa.nav.orders },
  { page: 'payments', label: fa.nav.payments },
  { page: 'subscriptions', label: fa.nav.subscriptions },
  { page: 'settings', label: fa.nav.settings },
  { page: 'sms', label: fa.nav.sms },
  { page: 'zones', label: fa.nav.zones },
  { page: 'audit', label: fa.nav.audit },
  { page: 'status', label: fa.nav.status },
];

export function AppShell({
  user,
  active,
  onLogout,
  children,
}: {
  user: SessionUser;
  active: PageId;
  onLogout: () => void;
  children: ReactNode;
}): JSX.Element {
  const items = NAV.filter((item) => canAccess(user.role, item.page));
  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-line bg-raised border-b lg:min-h-screen lg:w-60 lg:border-b-0 lg:border-e">
        <div className="px-4 py-4">
          <p className="text-base font-bold">{fa.app.title}</p>
          <p className="text-xs text-muted">{fa.app.subtitle}</p>
        </div>
        <nav className="flex flex-wrap gap-1 px-2 pb-3 lg:flex-col">
          {items.map((item) => (
            <a
              key={item.page}
              href={buildHash(item.page)}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                active === item.page ? 'bg-brand text-brandInk' : 'text-ink hover:bg-surface'
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="border-line bg-raised flex items-center justify-between border-b px-4 py-3">
          <div className="text-xs text-muted">
            {user.displayName ?? user.phone} · {fa.app.subtitle}
          </div>
          <button type="button" className="btn px-2 py-1 text-xs" onClick={onLogout}>
            {fa.app.logout}
          </button>
        </header>
        <main className="mx-auto max-w-6xl p-4">{children}</main>
      </div>
    </div>
  );
}
