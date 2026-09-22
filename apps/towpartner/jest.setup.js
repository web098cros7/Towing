/**
 * Runs before every test file.
 *
 * Kept deliberately thin: the more the runner pretends, the less a passing test
 * says about the app. Add a mock here only when a real module cannot run
 * outside a device at all, and say which and why.
 */

// react-native-reanimated cannot run without its native half. This is the
// mock the library itself ships for exactly this purpose.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
