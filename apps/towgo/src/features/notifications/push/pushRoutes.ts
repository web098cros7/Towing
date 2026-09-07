import type { NotificationAction } from './handleNotificationData';

/**
 * Where a tapped notification takes you.
 *
 * ⚠ THIS WAS THE MISSING HALF. `applyNotificationData` has RETURNED a
 * `NotificationAction` since Phase 13, and `useNotificationListeners` threw the
 * return value away — its own comment named phases "15/17/19" as the owners of
 * a route table, because until money screens existed there was nowhere for a
 * customer's notification to go. Phase 19 is the last of the three.
 *
 * A TABLE RATHER THAN A PARSER. The server sends `route` as a deep link
 * (`moveyo://bookings/<id>`), and turning an arbitrary string into a navigation
 * call is how a notification payload becomes an open redirect into any screen
 * in the app. This maps a closed set of known shapes and IGNORES everything
 * else — an unrecognised route opens the app and does nothing, which is the
 * correct failure.
 */

export type PushDestination =
  | { screen: 'BookingDetails'; params: { bookingId: string } }
  | { screen: 'Tracking'; params: { bookingId: string } }
  | { screen: 'Wallet' }
  | { screen: 'Notifications' };

const SCHEME = 'moveyo://';

/** A UUID, and nothing else — the id lands straight in a route param. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function destinationFor(action: NotificationAction): PushDestination | null {
  if (action.kind !== 'navigate') return null;

  const route = action.route.startsWith(SCHEME) ? action.route.slice(SCHEME.length) : action.route;
  const [head, id] = route.split('/');

  switch (head) {
    case 'bookings':
      // §12.2's `completed_invoice` and both `payment_status` triggers all send
      // this. Without an id there is a list to fall back on.
      if (id && UUID.test(id)) return { screen: 'BookingDetails', params: { bookingId: id } };
      return { screen: 'Notifications' };

    case 'tracking':
      return id && UUID.test(id) ? { screen: 'Tracking', params: { bookingId: id } } : null;

    case 'wallet':
      return { screen: 'Wallet' };

    case 'notifications':
      return { screen: 'Notifications' };

    default:
      // Includes every `towpartner://…` route — the driver app's triggers share
      // this registry, and a customer device must never try to follow one.
      return null;
  }
}
