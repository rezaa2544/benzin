import { t } from '../lib/i18n.js';
import { Icon, type IconName } from './icons.js';

export type NavKey = 'market' | 'search' | 'create' | 'orders' | 'profile' | 'styleGuide';

export interface NavItem {
  key: NavKey;
  labelKey: string;
  icon: IconName;
  href: string;
  /** The middle action is rendered as a raised pill. */
  primary?: boolean;
}

/** One source of truth for the bottom bar; the shell and the style guide both read it. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'market', labelKey: 'nav.market', icon: 'market', href: '/market' },
  { key: 'search', labelKey: 'nav.search', icon: 'search', href: '/search' },
  { key: 'create', labelKey: 'nav.create', icon: 'plus', href: '/new', primary: true },
  { key: 'orders', labelKey: 'nav.orders', icon: 'orders', href: '/orders' },
  { key: 'profile', labelKey: 'nav.profile', icon: 'profile', href: '/profile' },
];

export interface BottomNavProps {
  active?: NavKey;
  onNavigate?: (key: NavKey, href: string) => void;
}

/** Five destinations, 44px minimum targets, safe-area padding for iPhone home bars. */
export function BottomNav({ active, onNavigate }: BottomNavProps): JSX.Element {
  return (
    <nav
      aria-label={t('nav.market')}
      className="fixed inset-x-0 bottom-0 z-nav border-t border-line bg-surface"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <ul className="phone-frame flex items-stretch justify-between gap-1 py-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === active;
          return (
            <li key={item.key} className="flex-1">
              <a
                href={item.href}
                onClick={(event) => {
                  if (!onNavigate) return;
                  event.preventDefault();
                  onNavigate(item.key, item.href);
                }}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-tap flex-col items-center justify-center gap-0.5 rounded-sm px-1 py-1 text-[0.6875rem] transition duration-fast ${
                  isActive ? 'text-brand' : 'text-muted hover:text-ink'
                }`}
              >
                <span
                  className={
                    item.primary ? 'mb-0.5 rounded-pill bg-brand p-2 text-brandInk shadow-card' : ''
                  }
                >
                  <Icon name={item.icon} size={item.primary ? 20 : 22} />
                </span>
                <span className={isActive ? 'font-medium' : ''}>{t(item.labelKey)}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
