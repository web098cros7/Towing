/**
 * §9.1.9's payment and wallet query keys.
 *
 * NAMESPACED SEPARATELY FROM `bookingsKeys`, deliberately, and for the reason
 * `trackingKeys` gives: a wallet balance invalidated after a capture must not
 * drag the heavy booking detail with it.
 *
 * The dotted namespaces match what the server's push payloads send —
 * `pushDataPayloadSchema.invalidate` is split on `.` into a raw query key, so
 * `'wallet.balance'` from a §12.2 trigger has to land on `['wallet','balance']`
 * exactly. `push-routing.spec` pins that.
 */
export const paymentKeys = {
  all: ['payments'] as const,
  /** The gateway order for one booking. Never cached — see the queries file. */
  intent: (bookingId: string) => ['payments', 'intent', bookingId] as const,
};

export const walletKeys = {
  all: ['wallet'] as const,
  balance: () => ['wallet', 'balance'] as const,
  transactions: () => ['wallet', 'transactions'] as const,
};

export const couponKeys = {
  all: ['coupons'] as const,
};

export const ratingKeys = {
  all: ['ratings'] as const,
  forBooking: (bookingId: string) => ['ratings', bookingId] as const,
};

export const invoiceKeys = {
  all: ['invoices'] as const,
  forBooking: (bookingId: string) => ['invoices', bookingId] as const,
};
