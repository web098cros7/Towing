import { z } from 'zod';
import { unsignedPaiseSchema } from '../common/money';

/**
 * The Operations dashboard's numbers (W3, §9.4.2) — defined ONCE here, because
 * they reach the console by two paths that must agree: `GET /v1/admin/ops/dashboard`
 * and the `ops:metrics` socket frame the broadcaster pushes.
 *
 * Every definition below is a direct transcription of the guide's KPI table.
 * The things dashboards usually get wrong, written down so they cannot drift:
 *
 *  - Day boundaries are IST (`istDayStart()`), not UTC — the mistake that cost
 *    a day of driver earnings once already.
 *  - `searching` EXCLUDES dormant scheduled bookings: a scheduled booking sits
 *    in `searching` until its dispatch delay elapses (A18's `booking_created`
 *    carries `scheduledAt` for exactly this), and counting it as an active
 *    search would inflate the tile every night.
 *  - Fill rate's denominator counts bookings still `searching` on NEITHER side,
 *    and is `null` when nothing has resolved — see `ops.ts` for why.
 *  - `onlineDrivers` is Postgres (online + approved + pinged within 60 s);
 *    `dispatchableNow` is Redis (Σ `ZCARD drivers:online:{zone}`) — the number
 *    dispatch actually sees, which is why it is shown as a sub-count.
 */

export const adminOpsKpisSchema = z.object({
  /** `ACTIVE_JOB_STATUSES`: assigned, en_route, arrived, in_progress. */
  activeRides: z.number().int().min(0),
  /** Live searches only — dormant scheduled bookings do not count. */
  searching: z.number().int().min(0),
  onlineDrivers: z.number().int().min(0),
  /**
   * Sum of the per-zone `drivers:online:{zone}` GEO set cardinalities over the
   * active zones. Null when Redis is unreachable (`degraded: true`) — "unknown"
   * and "zero" are different facts and the tile must not conflate them.
   */
  dispatchableNow: z.number().int().min(0).nullable(),
  todayGmvPaise: unsignedPaiseSchema,
  todayCommissionPaise: unsignedPaiseSchema,
  pendingKyc: z.number().int().min(0),
  pendingPayouts: z.number().int().min(0),
  /** matched ÷ (matched + no_drivers_found + cancelled-while-searching), today's creations. */
  fillRatePct: z.number().min(0).max(100).nullable(),
  cancelledToday: z.number().int().min(0),
  completedUnpaid: z.number().int().min(0),
  /** p50/p90 of (first accepted attempt − booking created_at), today's creations. */
  timeToMatchP50Seconds: z.number().int().min(0).nullable(),
  timeToMatchP90Seconds: z.number().int().min(0).nullable(),
});
export type AdminOpsKpis = z.infer<typeof adminOpsKpisSchema>;

/**
 * Sidebar badge counts (§3.2), pushed as `ops:badges` and seeded by
 * `GET /v1/admin/ops/badges`.
 *
 * FOUR OF THE SEVEN ARE STRUCTURALLY ZERO until their owning workstream ships
 * the table they count — `sos_alerts` (W14), `disputes` (W8), tickets (W15),
 * `suspension_requests` (W6). Zero is the truthful answer today (the feature
 * does not exist, so nothing is open), and the keys exist now so the wire
 * shape never changes when each source lands. The three computed today are
 * pending KYC reviews, pending payout approvals and open deletion requests.
 */
export const adminOpsBadgesSchema = z.object({
  pendingKyc: z.number().int().min(0),
  pendingPayouts: z.number().int().min(0),
  openSos: z.number().int().min(0),
  openDisputes: z.number().int().min(0),
  openTickets: z.number().int().min(0),
  suspensionRequests: z.number().int().min(0),
  deletionRequests: z.number().int().min(0),
});
export type AdminOpsBadges = z.infer<typeof adminOpsBadgesSchema>;
