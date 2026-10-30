import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', '.astro/', '.netlify/', '.data/', 'node_modules/', 'public/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: 'readonly', process: 'readonly', window: 'readonly', document: 'readonly', location: 'readonly',
        navigator: 'readonly', history: 'readonly', fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        FormData: 'readonly', File: 'readonly', Blob: 'readonly', Response: 'readonly', Request: 'readonly',
        Headers: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', matchMedia: 'readonly',
        createImageBitmap: 'readonly', Buffer: 'readonly', TextEncoder: 'readonly', Intl: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
