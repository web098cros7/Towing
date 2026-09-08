export const realtimeKeys = {
  all: ['realtime'] as const,
  /**
   * Single stable key holding the whole map state. Socket batches patch it with
   * `setQueryData`; the §18 resync invalidates it. One key, so both paths target
   * the same cache entry.
   */
  positions: () => [...realtimeKeys.all, 'positions'] as const,
};
