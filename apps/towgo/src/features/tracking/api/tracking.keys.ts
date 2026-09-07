export const trackingKeys = {
  all: ['tracking'] as const,
  /**
   * The live tracking payload for one booking (§19.2's polling rung).
   *
   * SEPARATE FROM `bookingsKeys.detail`, deliberately. The detail is a heavy
   * read nothing needs at ten-second cadence; this one is polled for the length
   * of a trip. Sharing a key would mean either the detail refetching every ten
   * seconds or the tracking data going stale behind it.
   */
  live: (bookingId: string) => ['tracking', 'live', bookingId] as const,
  /** §11.7's share-link state. */
  share: (bookingId: string) => ['tracking', 'share', bookingId] as const,
  /** §3.5's fee preview, fetched when the cancel sheet opens. */
  cancellationQuote: (bookingId: string) => ['tracking', 'cancel-quote', bookingId] as const,
  /** §9.1.7's call button. */
  contact: (bookingId: string) => ['tracking', 'contact', bookingId] as const,
};
