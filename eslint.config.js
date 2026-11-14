import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for the whole workspace (task E0-02).
 * Type-aware rules are intentionally left to `tsc --noEmit`: lint stays fast and
 * deterministic in CI, while strictness is enforced by the type checker.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      'drizzle/**',
      'eslint.config.js',
      'commitlint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', crypto: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['error', 'warn', 'info'] }],
    },
  },
  {
    files: ['**/test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // The service worker is plain JS on purpose (no build step, no bundler): declare the worker
    // globals it runs against instead of pulling a browser/types package into the app (E9-15).
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        URL: 'readonly',
        addEventListener: 'readonly',
      },
    },
  },
  prettier,
);
