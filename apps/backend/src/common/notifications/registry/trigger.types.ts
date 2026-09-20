import type { NotificationCategory, NotificationChannel } from '@towing/api-contracts';
import type { Database } from '../../../db/db.module';
import type { NotificationSubjectType } from '../../../db/schema/notifications';

/**
 * The registry's type surface: event → channels → template → recipient
 * resolver → preference category.
 *
 * The load-bearing idea is that a `Recipient` carries ADDRESSES, and the only
 * thing that can produce one is a trigger's `resolve()`. A producer never sees
 * a phone number, and a channel adapter never sees a subject id — which is what
 * makes the pre-Phase-13 `to: <uuid>` bug unrepresentable rather than merely
 * fixed (invariant 69).
 */

/**
 * Every addressable recipient kind: the three DB-backed inbox subjects, plus
 * the two W14 introduced.
 *
 * `contact` is one row of `sos_alert_contacts` — the trigger-time snapshot of
 * an emergency contact, which is deliberately NOT a database subject (the
 * person may have no account at all). `ops` is an on-call admin (or the ops
 * mailbox) reached by email/SMS because admins have no push devices.
 *
 * Neither writes an inbox row — `NotificationService.writeEvent` admits only
 * the three database-backed types — and both dedupe correctly anyway, because
 * the delivery key is derived from this pair (`contact:<id>`, `ops:<id>`), so
 * re-resolution at delivery time finds exactly the same recipient.
 */
export type RecipientSubjectType = NotificationSubjectType | 'contact' | 'ops';

export interface Recipient {
  subjectType: RecipientSubjectType;
  subjectId: string;
  /** E.164, or null when this subject has no phone on file. */
  mobile: string | null;
  email: string | null;
  /**
   * Live push tokens for this subject — one per registered, unrevoked device.
   * A LIST, not a value: a driver with a phone and a tablet must get both, and
   * that is the entire reason `devices` is a table rather than a column.
   */
  pushTokens: Array<{ deviceId: string; token: string }>;
  /** Merged over `SUBJECT_NOTIFICATION_PREF_DEFAULTS` by the resolver. */
  prefs: Record<string, boolean>;
}

export interface TriggerContext {
  db: Database;
  /** The only producer of a deliverable address — see `RecipientResolverService`. */
  resolver: RecipientResolver;
}

/**
 * The slice of `RecipientResolverService` a trigger may use, as a structural
 * type so `triggers.ts` stays a pure data module with no Nest import and no
 * cycle back into the service that consumes it.
 */
export interface RecipientResolver {
  resolveUser(userId: string): Promise<Recipient | null>;
  resolveDriver(driverId: string): Promise<Recipient | null>;
  resolveFleet(fleetId: string): Promise<Recipient | null>;
  /** Batch variant — §13's G12 broadcast reaches several drivers in one call. */
  resolveManyDrivers(driverIds: string[]): Promise<Recipient[]>;
  resolveWalletOwner(
    ownerType: 'user' | 'driver' | 'fleet',
    ownerId: string,
  ): Promise<Recipient | null>;
}

/**
 * A §12.2 row this phase (or a later one) actually implements.
 *
 * `deliveredBy: 'otp_port'` is the one escape hatch: the OTP row is genuinely
 * part of §12.2 and must be accounted for, but its delivery stays on `OtpPort`
 * because routing a live one-time code through `notification_events.payload`
 * would put it, in plaintext, in a table with no TTL and no purge until Phase
 * 20 — reversing the hash-at-rest posture `login_challenges.code_hash` has.
 */
/**
 * What to attach, named rather than carried.
 *
 * One kind today. A union rather than a bare `bookingId` because the next one
 * (a monthly statement, say) should widen this type rather than overload the
 * field's meaning.
 */
export type AttachmentRef = { kind: 'invoice'; bookingId: string };

export interface RegisteredTrigger<P = Record<string, unknown>> {
  /** Event key, e.g. `driver.kyc.approved`. Matches `PushDataPayload.event`. */
  event: string;
  /** The `MATRIX_12_2` row this claims. */
  matrixRow: string;
  channels: NotificationChannel[];
  /** Catalog key. Resolved through `TEMPLATES` at fan-out time. */
  template: string;
  category: NotificationCategory;
  /**
   * §12.3 "transactional/safety always on". An always-on trigger bypasses
   * `PreferenceService` entirely — a user opt-out must never be able to
   * suppress a KYC rejection, a payout failure or (W14) an SOS.
   */
  alwaysOn: boolean;
  /** §12.3 high-priority delivery — batching bypass + the dedicated Android channel. */
  priority?: 'normal' | 'high';
  /** Where a tap should land, and what the client should invalidate. */
  push?: { action: 'refetch' | 'open'; invalidate?: string; route?: string };
  /**
   * Optional collapse key for a double-submitted producer action.
   *
   * ⚠ It must be STABLE across the two calls it is meant to collapse — keying
   * on a per-call `new Date()` dedupes nothing — and it must not be stable
   * across two legitimately separate occurrences, or it suppresses the second
   * one forever. Each trigger below documents its choice.
   */
  dedupeKey?: (payload: P) => string;
  /**
   * §12.2's attachment, resolved for the EMAIL channel only.
   *
   * A REFERENCE, NOT BYTES. The registry is pure data — it has no database, no
   * storage port and no business being handed a megabyte of PDF — so a trigger
   * declares WHAT to attach and the dispatcher fetches it. Push, SMS and
   * WhatsApp ignore this entirely; there is nothing to attach to them.
   */
  attachmentsFor?: (payload: P) => AttachmentRef;
  /** Turns domain ids into addresses. THE ONLY producer of a deliverable `to`. */
  resolve: (payload: P, ctx: TriggerContext) => Promise<Recipient[]>;
  /** Template variables. Rendered by the catalog, never by an adapter. */
  variables: (payload: P, recipient: Recipient) => Record<string, string>;
  /** `'spine'` (default) or `'otp_port'` — see above. */
  deliveredBy?: 'spine' | 'otp_port';
}

/**
 * A §12.2 row whose emitting feature does not exist yet.
 *
 * This is NOT a TODO comment: `registry.spec.ts` reads it, reports the row by
 * name, and fails if a row is neither registered nor listed here. The phase
 * number is a promise the plan document also carries.
 */
export interface DeferredTrigger {
  matrixRow: string;
  unregisteredUntilPhase: 15 | 17 | 18 | 19 | 20;
  /** Why it cannot be wired now — always "the event does not exist yet", specifically. */
  reason: string;
}
