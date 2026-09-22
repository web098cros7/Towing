import type { NotificationAction } from './handleNotificationData';

/**
 * Where a tapped notification takes you.
 *
 * ⚠ THIS WAS THE MISSING HALF. `applyNotificationData` has RETURNED a
 * `NotificationAction` since Phase 13, and `useNotificationListeners` threw the
 * return value away — its own comment named phases "15/17/19" as the owners of
 * a route table, because until money screens existed there was nowhere for a
 * driver's notification to go. Phase 19 is the last of the three.
 *
 * A TABLE RATHER THAN A PARSER. The server sends `route` as a deep link
 * (`towpartner://offer`), and turning an arbitrary string into a navigation
 * call is how a notification payload becomes an open redirect into any screen
 * in the app. This maps a closed set of known shapes and IGNORES everything
 * else — an unrecognised route opens the app and does nothing, which is the
 * correct failure.
 */

export type PushDestination =
  | { screen: 'OfferTakeover' }
  | { screen: 'AssignedJob' }
  | { screen: 'JobChat'; params: { bookingId: string } }
  | { screen: 'Tabs'; params: { screen: 'Earnings' } }
  | { screen: 'KycStatus' }
  | { screen: 'HelpSupport' }
  | { screen: 'Notifications' };

const SCHEME = 'towpartner://';

/**
 * The held booking id is passed in rather than read here: `job/chat` is the
 * only route that needs it, and the caller already has the cache in hand.
 * `null` means the driver is not holding a job — the chat route then falls
 * back to the job screen, which is the honest place to land when there is no
 * conversation to open.
 */
export function destinationFor(
  action: NotificationAction,
  heldBookingId: string | null,
): PushDestination | null {
  if (action.kind !== 'navigate') return null;

  const route = action.route.startsWith(SCHEME) ? action.route.slice(SCHEME.length) : action.route;

  switch (route) {
    case 'offer':
      return { screen: 'OfferTakeover' };

    case 'job':
      return { screen: 'AssignedJob' };

    case 'job/chat':
      return heldBookingId
        ? { screen: 'JobChat', params: { bookingId: heldBookingId } }
        : { screen: 'AssignedJob' };

    case 'earnings':
      return { screen: 'Tabs', params: { screen: 'Earnings' } };

    case 'kyc':
      return { screen: 'KycStatus' };

    case 'support':
      return { screen: 'HelpSupport' };

    case 'notifications':
      return { screen: 'Notifications' };

    default:
      // Includes every `moveyo://…` route — the customer app's triggers share
      // this registry, and a driver device must never try to follow one.
      return null;
  }
}
