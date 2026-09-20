import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB, type Database } from '../../db/db.module';
import {
  isInboxSubjectType,
  notificationEvents,
  notifications,
  type NotificationSubjectType,
} from '../../db/schema/notifications';
import { isUniqueViolation } from '../errors/pg-errors';
import { QUEUE, type QueuePort } from '../queue/queue.port';
import { RecipientResolverService } from './recipient-resolver.service';
import { TRIGGERS_BY_EVENT } from './registry/triggers';
import type { Recipient, RegisteredTrigger } from './registry/trigger.types';
import { renderTemplate, type TemplateKey } from './template-catalog';

/** Registered-but-unresolvable subject placeholder — see the `ops.ledger_drift` trigger. */
export const OPS_PSEUDO_SUBJECT = '00000000-0000-0000-0000-000000000000';

/**
 * THE PRODUCER-FACING SEAM. Every notification in the system starts here.
 *
 * A producer calls `emit('driver.kyc.approved', { driverId, … })` with DOMAIN
 * IDS and nothing else — never a phone number, never a channel, never a
 * template. What that becomes is the registry's business (invariant 69).
 *
 * WHAT `emit()` DOES SYNCHRONOUSLY, in one transaction:
 *   1. writes the `notification_events` row — the durable record; and
 *   2. resolves recipients and writes their `notifications` inbox rows.
 *
 * WHAT IT DOES NOT DO: talk to a vendor. It enqueues `notifications.fanout`
 * and returns (invariant 72). A provider outage must never roll back a
 * completed money transition — the best-effort `try/catch` wrappers already in
 * `payouts.service.ts` and `compliance.service.ts` were buying that property by
 * remembering to catch at every site; enqueueing gives it structurally.
 *
 * WHY THE INBOX IS WRITTEN HERE AND NOT IN THE WORKER (invariant 74). The bell
 * has to be correct even when nothing is delivered: `NOTIFY_ENABLED=false`,
 * every channel on the log adapter, a recipient with no push token, and —
 * critically — `QUEUE_ENABLED=false`, which `src/test/setup.ts` sets for the
 * whole suite and which `bullmq.adapter.ts` handles by logging and dropping the
 * job. Writing the inbox in the worker would leave the in-app centre untestable
 * and empty in every zero-credential demo, which is precisely what this phase
 * exists to make demonstrable.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
    private readonly resolver: RecipientResolverService,
  ) {}

  /**
   * @returns the `notification_events.id`, or null when there was no registered
   *   trigger, the row is delivered by `OtpPort`, or an identical event already
   *   existed under the trigger's dedupe key.
   */
  async emit(event: string, payload: Record<string, unknown>): Promise<string | null> {
    const trigger = TRIGGERS_BY_EVENT.get(event);

    if (!trigger) {
      // A typo in an event name must be loud. It cannot throw — that would let
      // a notification bug roll back a money transition — but a silent no-op is
      // exactly how "we forgot to notify the customer" happens.
      this.logger.error(`emit("${event}") has no registered trigger — nothing will be sent`);
      return null;
    }

    if (trigger.deliveredBy === 'otp_port') return null;

    const dedupeKey = trigger.dedupeKey ? asDedupe(trigger)(payload) : null;

    let eventId: string | null;
    try {
      eventId = await this.writeEvent(event, payload, dedupeKey, trigger);
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.debug(`emit("${event}") collapsed by dedupe key ${dedupeKey}`);
        return null;
      }
      throw error;
    }

    if (!eventId) return null;

    // OUTSIDE the transaction: an enqueue inside it would fire even if the
    // producer's surrounding work later rolled back.
    await this.queue.enqueue('notifications.fanout', { eventId }, { jobId: `fanout:${eventId}` });

    return eventId;
  }

  private async writeEvent(
    event: string,
    payload: Record<string, unknown>,
    dedupeKey: string | null,
    trigger: RegisteredTrigger<never>,
  ): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(notificationEvents)
        .values({ event, payload, dedupeKey })
        .returning({ id: notificationEvents.id });

      if (!row) return null;

      // Resolution is a handful of indexed reads, cheap enough to sit in the
      // producer's transaction — and doing it here is what lets the inbox be
      // written now rather than in the worker.
      const recipients = await asResolve(trigger)(payload, {
        db: tx as unknown as Database,
        resolver: this.resolver,
      });

      // AN EXPLICIT ALLOWLIST, not "everything except the ops pseudo-subject".
      // Since W14 the recipient union also carries `contact` (a snapshot row)
      // and `ops` (an on-call admin) — neither is a subject the `notifications`
      // table admits, and neither has a bell to ring. The pseudo-subject check
      // stays too: that one is a `fleet`-typed placeholder with no row behind it.
      const inboxRows = recipients.filter(isInboxRecipient).map((recipient) => {
        // The id is generated HERE rather than by `gen_random_uuid()`, so the
        // push payload can carry `notificationId` in the same insert. A tap
        // needs to mark exactly this row read, and a second UPDATE pass to
        // stamp it would be one more thing to get wrong.
        const id = randomUUID();
        const variables = asVariables(trigger)(payload, recipient);
        const rendered = renderTemplate(trigger.template as TemplateKey, variables);

        const data: Record<string, string> = {
          event,
          notificationId: id,
          action: trigger.push?.action ?? 'open',
        };
        if (trigger.push?.invalidate) data.invalidate = trigger.push.invalidate;
        if (trigger.push?.route) data.route = trigger.push.route;

        return {
          id,
          subjectId: recipient.subjectId,
          subjectType: recipient.subjectType,
          eventId: row.id,
          event,
          category: trigger.category,
          title: rendered.title ?? rendered.subject ?? event,
          body: rendered.body,
          data,
        };
      });

      if (inboxRows.length > 0) {
        await tx.insert(notifications).values(inboxRows);
      }

      return row.id;
    });
  }
}

/**
 * The registry stores triggers with their payload parameter erased so they can
 * share one array (see `defineTrigger`). These three re-widen at the call site,
 * in one place, rather than scattering casts through the service.
 */
function asDedupe(trigger: RegisteredTrigger<never>) {
  return trigger.dedupeKey as unknown as (payload: Record<string, unknown>) => string;
}

function asResolve(trigger: RegisteredTrigger<never>) {
  return trigger.resolve as unknown as (
    payload: Record<string, unknown>,
    ctx: { db: Database; resolver: RecipientResolverService },
  ) => Promise<Recipient[]>;
}

function asVariables(trigger: RegisteredTrigger<never>) {
  return trigger.variables as unknown as (
    payload: Record<string, unknown>,
    recipient: Recipient,
  ) => Record<string, string>;
}

/**
 * An inbox recipient: one of the three database-backed subject types (migration
 * 0010's CHECK) that is not the synthetic ops placeholder. Everything else —
 * `contact`, `ops` — is delivery-only: a snapshot row or an on-call admin has
 * no in-app centre to write to.
 */
function isInboxRecipient(
  recipient: Recipient,
): recipient is Recipient & { subjectType: NotificationSubjectType } {
  return isInboxSubjectType(recipient.subjectType) && recipient.subjectId !== OPS_PSEUDO_SUBJECT;
}
