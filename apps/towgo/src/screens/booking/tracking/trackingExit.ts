/**
 * Where the tracking screen hands a trip off to, for each status that ends
 * its time on screen. Pure, so every exit is unit-tested (the screen itself is
 * too heavy to render in a test).
 *
 * - `completed` goes to 27 Payment.
 * - `paid`, `disputed` and `refunded` go to 20 Booking Details, where the trip's
 *   outcome is (T15 added the last two; they used to leave the old app's
 *   sheet on screen).
 * - `searching` and `no_drivers_found` go back to 16 Searching (T15): the
 *   driver dropped out after accepting and the server is finding another one,
 *   Uber's behaviour. The customer is told why only if this screen had seen a
 *   driver on the trip; a trip opened here before its first driver simply
 *   belongs on 16.
 * - `cancelled` goes Home.
 *
 * `null` for every status the screen draws itself.
 */
export type TrackingExit =
  | { to: 'Payment' }
  | { to: 'BookingDetails' }
  | { to: 'Searching'; tellDriverDroppedOut: boolean }
  | { to: 'Home' };

export function trackingExitFor(
  status: string | undefined,
  hadDriver: boolean,
): TrackingExit | null {
  switch (status) {
    case 'completed':
      return { to: 'Payment' };
    case 'paid':
    case 'disputed':
    case 'refunded':
      return { to: 'BookingDetails' };
    case 'searching':
    case 'no_drivers_found':
      return { to: 'Searching', tellDriverDroppedOut: hadDriver };
    case 'cancelled':
      return { to: 'Home' };
    default:
      return null;
  }
}
