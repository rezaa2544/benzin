import type { ReactNode } from 'react';
import { BottomNav, type NavKey } from './BottomNav.js';
import { Icon } from './icons.js';
import { t } from '../lib/i18n.js';
import { themeLabelKey, type ThemeMode } from '../lib/theme.js';

export interface AppShellProps {
  title?: string;
  children: ReactNode;
  active?: NavKey;
  /** Hides the bottom bar on full-screen flows such as chat or the OTP screen. */
  hideNav?: boolean;
  onNavigate?: (key: NavKey, href: string) => void;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
  headerAction?: ReactNode;
}

/**
 * Phone frame: sticky header, scrollable content with room for the bar, fixed bottom nav.
 * The header carries the brand, the current screen title and the theme toggle, so every
 * later screen inherits the same chrome without re-implementing it.
 */
export function AppShell({
  title,
  children,
  active,
  hideNav = false,
  onNavigate,
  theme,
  onToggleTheme,
  headerAction,
}: AppShellProps): JSX.Element {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-nav border-b border-line bg-surface/95 backdrop-blur">
        <div className="phone-frame flex min-h-tap items-center justify-between gap-2 py-2">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-sm bg-brand text-brandInk">
              <Icon name="market" size={18} />
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-bold leading-tight">{t('app.name')}</span>
              {title ? <span className="text-[0.6875rem] text-muted">{title}</span> : null}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {headerAction}
            {onToggleTheme ? (
              <button
                type="button"
                onClick={onToggleTheme}
                className="btn btn-ghost min-w-tap px-2 text-xs"
                aria-label={t('nav.theme')}
                title={theme ? t(themeLabelKey(theme)) : undefined}
              >
                {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🌗'}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main
        className="phone-frame py-4"
        style={{
          paddingBottom: hideNav
            ? 'var(--space-6)'
            : 'calc(var(--nav-height) + var(--safe-bottom) + var(--space-4))',
        }}
      >
        {children}
      </main>

      {hideNav ? null : <BottomNav active={active} onNavigate={onNavigate} />}
    </div>
  );
}
