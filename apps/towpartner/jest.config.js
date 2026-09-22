const expoPreset = require('jest-expo/jest-preset');

/**
 * The driver app's test runner. Same setup as the customer app's.
 *
 * `jest-expo` rather than a hand-rolled config: it carries the transform,
 * module mapping and RN mocks that match the installed Expo SDK, so the setup
 * moves with the SDK instead of drifting from it.
 *
 * Two things the preset does not handle on its own, and both take the whole
 * suite down rather than failing a single test:
 *
 * 1. `transformIgnorePatterns`. React Native and the Expo packages ship
 *    untranspiled ESM, so the default "don't touch node_modules" rule makes
 *    Jest choke on the first `import` it meets. The published pattern is a list
 *    of package names anchored with a trailing slash, and it does not work
 *    under pnpm: real paths here look like
 *    `node_modules/.pnpm/@react-native+jest-preset@0_<hash>/node_modules/...`,
 *    where the scope separator is `+` rather than `/`, so every anchored name
 *    misses. Matching the substring anywhere in the path survives both layouts.
 *
 * 2. `.mjs`. The preset's JavaScript rule is `\.[jt]sx?$`, which does not match
 *    `.mjs` — and `lucide-react-native`, behind the icon barrel most screens
 *    import, resolves to `.mjs` under the `react-native` export condition. Its
 *    own Babel transform is reused for that extension; overriding the preset's
 *    transform map outright would drop the asset transformers with it.
 */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transform: {
    ...expoPreset.transform,
    '\\.mjs$': expoPreset.transform['\\.[jt]sx?$'],
  },
  transformIgnorePatterns: [
    'node_modules/(?!.*(react-native|@react-native|expo|@expo|react-navigation|@react-navigation|@towing|lucide-react-native|react-clone-referenced-element))',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // `testRegex`, not `testMatch`: the glob form resolves against a mixed
  // forward/backslash rootDir on Windows and matches nothing.
  testRegex: '\\.test\\.tsx?$',
};
