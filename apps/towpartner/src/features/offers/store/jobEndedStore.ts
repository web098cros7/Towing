import { create } from 'zustand';

/**
 * Why the held job disappeared.
 *
 * The job screen's empty state used to say "No active job" for every reason a
 * job could vanish — a customer cancel, an admin reassign, a fleet pause, or
 * the 15 s poll simply finding it gone. That is the honest answer to "is there
 * a job?" and a useless answer to "where did MY job go?", which is the question
 * a driver standing at a kerbside is actually asking.
 *
 * Kept OUT of the query cache on purpose: the cache holds server truth, and
 * "the customer cancelled" is a client-side explanation for an absence. Writing
 * it into `offersKeys.job()` would mean inventing a job-shaped object to carry
 * a message, and the next refetch would overwrite it anyway.
 *
 * `reason: 'gone'` is the poll's own verdict — the job was there, then it was
 * not, and nothing told us why. It is deliberately distinct from the three
 * named reasons so the copy can be honest about not knowing.
 */
/** `unable`: the driver ended it themselves from the unable-to-deliver sheet. */
export type JobEndedReason = 'cancelled' | 'reassigned' | 'fleet_suspended' | 'gone' | 'unable';

export interface JobEnded {
  bookingId: string | null;
  reason: JobEndedReason;
}

interface JobEndedState {
  ended: JobEnded | null;
  markEnded: (e: JobEnded) => void;
  clear: () => void;
}

export const useJobEndedStore = create<JobEndedState>((set) => ({
  ended: null,
  markEnded: (e) => set({ ended: e }),
  clear: () => set({ ended: null }),
}));

/**
 * Non-React callers — the socket frame handler and the push handler both run
 * outside any component, and both need to record why a job ended before the
 * job screen ever mounts to read it.
 */
export function markJobEnded(e: JobEnded): void {
  useJobEndedStore.getState().markEnded(e);
}

export function clearJobEnded(): void {
  useJobEndedStore.getState().clear();
}
