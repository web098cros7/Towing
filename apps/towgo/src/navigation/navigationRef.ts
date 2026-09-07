import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/**
 * The navigator, reachable from outside React.
 *
 * A push tap is handled by a listener registered in an effect, not by a
 * component that happens to be mounted — and by the time a COLD START's initial
 * notification is read, no screen exists to hold a `navigation` prop. A
 * container ref is the standard answer and the only one that covers both.
 *
 * `isReady()` matters: on a cold start the listener fires before the navigator
 * mounts, and navigating then is a silent no-op rather than an error.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
