// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const towingConfig = require('@towing/config/eslint');

/**
 * The shared preset, not Expo's config directly: `packages/config` exists to be
 * the one place these rules live, and both apps had drifted onto their own copy
 * of the Expo default — which is also why `pnpm lint` had never run here (ESLint
 * itself was not a dependency of either app).
 */
module.exports = defineConfig([
  ...towingConfig(),
  {
    // Jest defines these at runtime; without saying so, every test file is a
    // wall of `no-undef` and the real problems are invisible among them.
    files: ['**/*.test.ts', '**/*.test.tsx', 'jest.setup.js', 'jest.config.js'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
  {
    ignores: ['dist/*', 'coverage/*'],
  },
]);
