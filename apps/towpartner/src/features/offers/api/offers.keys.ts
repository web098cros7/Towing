export const offersKeys = {
  all: ['offers'] as const,
  /** The pending offer, if any. `null` is the common answer, not an error. */
  current: () => ['offers', 'current'] as const,
  /** The job the driver holds. A separate key: an offer dying must not evict it. */
  job: () => ['offers', 'job'] as const,
  /** One held/finished job by id, from job-history. */
  detail: (bookingId: string) => ['offers', 'detail', bookingId] as const,
  /** Trip chat, per booking. Oldest first. */
  messages: (bookingId: string) => ['offers', 'messages', bookingId] as const,
};
