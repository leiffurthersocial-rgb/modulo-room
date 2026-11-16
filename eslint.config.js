import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dev-dist',
      'node_modules',
      'test-results',
      'playwright-report',
      'screenshots',
      '.asset-cache',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  // Tests may assert presence with `!`; app code must use explicit checks.
  { files: ['tests/**', 'scripts/**'], rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },
);
