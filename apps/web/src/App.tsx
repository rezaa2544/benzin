import { useCallback, useEffect, useState } from 'react';
import { StyleGuidePage } from './pages/StyleGuidePage.js';
import {
  applyTheme,
  nextTheme,
  readTheme,
  resolveTheme,
  writeTheme,
  type ThemeMode,
} from './lib/theme.js';

const MEDIA = '(prefers-color-scheme: dark)';

/**
 * App root (task E9-01). Until the screen tasks land, `/` renders the style guide so the
 * design system can be reviewed on a real device; routing for screens arrives with E9-03.
 */
export function App(): JSX.Element {
  const [mode, setMode] = useState<ThemeMode>(() =>
    readTheme(typeof window === 'undefined' ? undefined : window.localStorage),
  );
  const [prefersDark, setPrefersDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MEDIA).matches,
  );

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

  const toggle = useCallback(() => {
    setMode((current) => {
      const next = nextTheme(current);
      writeTheme(window.localStorage, next);
      return next;
    });
  }, []);

  return <StyleGuidePage theme={mode} onToggleTheme={toggle} />;
}
