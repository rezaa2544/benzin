/**
 * The palette, spacing and radii are CSS variables in src/styles/tokens.css (task E9-01)
 * so light/dark themes swap by attribute and no hex value ever lands in a component.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        surface2: 'rgb(var(--surface-2) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        brandInk: 'rgb(var(--brand-ink) / <alpha-value>)',
        brandSoft: 'rgb(var(--brand-soft) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        accentSoft: 'rgb(var(--accent-soft) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        dangerSoft: 'rgb(var(--danger-soft) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        gold: 'rgb(var(--gold) / <alpha-value>)',
        silver: 'rgb(var(--silver) / <alpha-value>)',
        bronze: 'rgb(var(--bronze) / <alpha-value>)',
      },
      borderRadius: {
        xs: '0.5rem',
        sm: '0.75rem',
        card: '1rem',
        sheet: '1.5rem',
        pill: '999px',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px -12px rgb(0 0 0 / 0.18)',
        sheet: '0 -12px 40px -16px rgb(0 0 0 / 0.35)',
      },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
      maxWidth: { phone: '430px' },
      fontFamily: {
        sans: ['Vazirmatn', 'IRANSans', 'system-ui', 'Segoe UI', 'Tahoma', 'sans-serif'],
      },
      transitionDuration: { fast: '120ms', base: '200ms' },
    },
  },
  plugins: [],
};
