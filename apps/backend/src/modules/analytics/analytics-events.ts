import { sql } from 'drizzle-orm';
import type { DatabaseExecutor } from '../../db/db.module';

/**
 * §22.1's server-side event tracker (ToBeDoneEhsan 19vi).
 *
 * WHY THIS EXISTS: 19vi recorded that the four server-emitted events —
 * `booking_completed`, `payment_success`, `payment_failure`,
 * `booking_cancelled` — were structured log lines and nothing else. Log lines
 * are not a tracker: they have no schema, no query surface, and their history
 * is whatever the log retention happens to be. These rows are durable.
 *
 * CLIENT-EMITTED IS WRONG FOR MONEY FACTS, per the same note: a client-emitted
 * `payment_success` counts checkout sheets that returned success, which is not
 * the same fact as money landing. So every call site below sits where the fact
 * becomes durable — the state machine's transition (inside the caller's
 * transaction) and the single writer of failed payments.
 *
 * THE PROPS RULE: ids and enums only. No names, no numbers a person is
 * reachable on, no addresses. A failure reason is a gateway code, not a
 * person.
 *
 * A pure function over the caller's executor, deliberately — the state
 * machine takes no injectable dependencies (the money module depends on it;
 * the reverse would cycle), and the event must commit or roll back WITH the
 * fact it records.
 */
export const ANALYTICS_EVENT_NAMES = [
  'booking_completed',
  'payment_success',
  'payment_failure',
  'booking_cancelled',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export interface AnalyticsEventInput {
  name: AnalyticsEventName;
  bookingId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  props?: Record<string, unknown>;
}

export async function trackEvent(tx: DatabaseExecutor, event: AnalyticsEventInput): Promise<void> {
  await tx.execute(sql`
    insert into analytics_events (name, booking_id, subject_type, subject_id, props)
    values (
      ${event.name},
      ${event.bookingId ?? null}::uuid,
      ${event.subjectType ?? null},
      ${event.subjectId ?? null}::uuid,
      ${JSON.stringify(event.props ?? {})}::jsonb
    )
  `);
}
