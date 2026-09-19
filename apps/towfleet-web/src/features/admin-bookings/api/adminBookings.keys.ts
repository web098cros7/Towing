import type { AdminBookingsQuery } from '@towing/api-contracts';

/**
 * W8's bookings console keys.
 *
 * The LIST is keyed on the whole query, like every other server-filtered list
 * in the console — but every mutation invalidates the namespace (`all`) rather
 * than one key, because a cancel or a reassign changes rows on every filter
 * (a row moves OUT of `assigned` and INTO `cancelled`) and the operator has no
 * way to know which filter the next reader is on.
 */
export const adminBookingsKeys = {
  all: ['admin-bookings'] as const,
  list: (query: Partial<AdminBookingsQuery>) => [...adminBookingsKeys.all, 'list', query] as const,
  detail: (bookingId: string) => [...adminBookingsKeys.all, 'detail', bookingId] as const,
  invoice: (bookingId: string) => [...adminBookingsKeys.all, 'invoice', bookingId] as const,
};
