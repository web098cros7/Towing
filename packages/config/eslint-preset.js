// Shared flat ESLint config for every Towing package and app.
// Built on Expo's config (handles RN globals, Metro, TS, JSX) plus a
// hard rule that keeps raw color literals out of components — colors must
// come from the design-system theme (see @towing/theme).
const expoConfig = require('eslint-config-expo/flat');

/**
 * @param {object} [opts]
 * @param {boolean} [opts.enforceThemeColors] Ban hex/rgb color literals (for UI/feature code).
 */
function towingConfig({ enforceThemeColors = false } = {}) {
  /** @type {import('eslint').Linter.Config[]} */
  const config = [
    ...expoConfig,
    {
      // SCOPED TO TYPESCRIPT ON PURPOSE. Expo's config registers the
      // `@typescript-eslint` plugin only on its TS-specific blocks, and flat
      // config resolves a rule's plugin from the blocks that apply to the file
      // being linted. An unscoped block naming a `@typescript-eslint/…` rule
      // therefore applies to `.js` files too — where the plugin was never
      // registered — and ESLint refuses to start at all: "could not find plugin
      // @typescript-eslint". That is why this preset had no users.
      files: ['**/*.ts', '**/*.tsx'],
      rules: {
        // `_name` means "deliberately discarded" for a variable as much as for
        // an argument — the commonest case being a destructure that drops a
        // field, `const { messages: _messages, ...summary } = ticket`. Ignoring
        // the prefix only on arguments left that convention being reported.
        '@typescript-eslint/no-unused-vars': [
          'warn',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
          },
        ],
      },
    },
    {
      rules: {
        'import/order': 'off',
        /**
         * OFF DELIBERATELY. The rule wants `We&apos;ll` instead of `We'll` in
         * JSX text, to remove an ambiguity that belongs to HTML. Here the cost
         * is real and the benefit is not: this app's copy is held verbatim
         * against the Figma it came from, and it gets read and grepped as
         * English — `We&apos;ll keep you updated.` is neither. React Native
         * renders the apostrophe correctly either way.
         */
        'react/no-unescaped-entities': 'off',
      },
    },
    { ignores: ['node_modules/**', 'dist/**', '.expo/**', 'babel.config.js', 'metro.config.js'] },
  ];

  if (enforceThemeColors) {
    config.push({
      files: ['**/*.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'warn',
          {
            selector:
              "Literal[value=/^#(?:[0-9a-fA-F]{3,4}){1,2}$/], TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3}){1,2}/]",
            message:
              'No raw color literals — use tokens from @towing/theme (useTheme). Colors live only in the theme package.',
          },
        ],
      },
    });
  }

  return config;
}

module.exports = towingConfig;
module.exports.default = towingConfig;
