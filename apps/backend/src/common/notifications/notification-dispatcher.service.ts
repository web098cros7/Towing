import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { NotificationChannel } from '@towing/api-contracts';
import { DB, type Database } from '../../db/db.module';
import { devices } from '../../db/schema/devices';
import {
  notificationDeliveries,
  notificationEvents,
  notifications,
} from '../../db/schema/notifications';
import { ENV, type Env } from '../../config/env';
import { MetricsService } from '../observability/metrics.service';
import { QUEUE, type JobName, type QueuePort } from '../queue/queue.port';
import { ATTACHMENT_RESOLVER, type AttachmentResolverPort } from './attachment.port';
import type { ChannelSendParams } from './channel.port';
import { maskDestination } from './channels/log-channel.adapter';
import { ExpoPushAdapter } from './channels/expo-push.adapter';
import { NOTIFICATIONS, type NotificationPort } from './notification.port';
import { PreferenceService } from './preference.service';
import { RecipientResolverService } from './recipient-resolver.service';
import { TRIGGERS_BY_EVENT } from './registry/triggers';
import type { AttachmentRef, Recipient, RegisteredTrigger } from './registry/trigger.types';
import { renderTemplate, TEMPLATES, type TemplateKey } from './template-catalog';

/** Per-channel retry budgets. SMS is cheapest to retry; email is slowest to matter. */
const RETRY: Record<NotificationChannel, { attempts: number; backoffMs: number }> = {
  push: { attempts: 3, backoffMs: 5_000 },
  sms: { attempts: 4, backoffMs: 10_000 },
  whatsapp: { attempts: 4, backoffMs: 10_000 },
  email: { attempts: 3, backoffMs: 30_000 },
};

const DELIVER_JOB: Record<NotificationChannel, JobName> = {
  push: 'notifications.deliver.push',
  sms: 'notifications.deliver.sms',
  whatsapp: 'notifications.deliver.whatsapp',
  email: 'notifications.deliver.email',
};

/**
 * The fan-out and delivery workers (§12.3).
 *
 * `NotificationService.emit()` wrote the event and the inbox rows and returned;
 * everything from here runs off the queue, so no request path and no database
 * transaction ever waits on a vendor (invariant 72).
 */
@Injectable()
export class NotificationDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(NOTIFICATIONS) private readonly notifications: NotificationPort,
    private readonly resolver: RecipientResolverService,
    private readonly preferences: PreferenceService,
    private readonly metrics: MetricsService,
    private readonly expo: ExpoPushAdapter,
    // OPTIONAL: a deployment with no producer bound sends emails without
    // files, which is the correct degraded behaviour rather than a failure.
    @Optional()
    @Inject(ATTACHMENT_RESOLVER)
    private readonly attachmentResolver?: AttachmentResolverPort,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue.process('notifications.fanout', async ({ eventId }) => {
      await this.fanout(eventId);
    });

    // Registered one at a time rather than in a loop: `JobPayloads` is a typed
    // registry, so `process(DELIVER_JOB[channel], …)` would hand the handler a
    // union of every job's payload and lose the check that makes the registry
    // worth having.
    this.queue.process('notifications.deliver.push', async ({ deliveryId }) => {
      await this.deliver('push', deliveryId);
    });
    this.queue.process('notifications.deliver.sms', async ({ deliveryId }) => {
      await this.deliver('sms', deliveryId);
    });
    this.queue.process('notifications.deliver.whatsapp', async ({ deliveryId }) => {
      await this.deliver('whatsapp', deliveryId);
    });
    this.queue.process('notifications.deliver.email', async ({ deliveryId }) => {
      await this.deliver('email', deliveryId);
    });

    this.queue.process('notifications.push-receipts', async ({ deliveryIds }) => {
      await this.reconcileReceipts(deliveryIds);
    });

    this.queue.process('notifications.sweep', async () => {
      await this.sweep();
    });

    // The §12.3 depth alarm's counter. Taken from the queue rather than from
    // `notification_deliveries.attempts` — see `QueuePort.onDeadLetter`.
    this.queue.onDeadLetter((job) => {
      if (job.startsWith('notifications.')) this.metrics.observeDeadLetter(job);
    });

    await this.queue.schedule('notifications.sweep', { reason: 'cron' }, this.env.NOTIFY_SWEEP_CRON);
  }

  // -------------------------------------------------------------------------
  // Fan-out
  // -------------------------------------------------------------------------

  async fanout(eventId: string): Promise<void> {
    const [event] = await this.db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.id, eventId))
      .limit(1);

    if (!event) {
      this.logger.warn(`fanout for unknown event ${eventId}`);
      return;
    }
    if (event.fannedOutAt) return;

    const trigger = TRIGGERS_BY_EVENT.get(event.event);
    if (!trigger) {
      this.logger.error(`fanout for "${event.event}" has no registered trigger`);
      return;
    }

    const recipients = await asResolve(trigger)(event.payload, {
      db: this.db,
      resolver: this.resolver,
    });

    const rows = recipients.flatMap((recipient) =>
      this.deliveryRowsFor(eventId, trigger, recipient),
    );

    if (rows.length > 0) {
      await this.db.insert(notificationDeliveries).values(rows).onConflictDoNothing();
    }

    const queued = await this.db
      .select({ id: notificationDeliveries.id, channel: notificationDeliveries.channel })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.eventId, eventId),
          eq(notificationDeliveries.status, 'queued'),
        ),
      );

    // ENQUEUE FIRST, STAMP SECOND. A crash between the stamp and the enqueue
    // would strand every delivery permanently, because the `fannedOutAt` guard
    // above makes the retry a no-op. Enqueuing first means the worst case is a
    // duplicate job — which `deliver()`'s compare-and-set makes harmless — and
    // `notifications.sweep` repairs the rest.
    for (const row of queued) {
      const { attempts, backoffMs } = RETRY[row.channel];
      await this.queue.enqueue(
        DELIVER_JOB[row.channel],
        { deliveryId: row.id },
        { jobId: `deliver:${row.id}`, attempts, backoffMs },
      );
    }

    await this.db
      .update(notificationEvents)
      .set({ fannedOutAt: new Date() })
      .where(eq(notificationEvents.id, eventId));
  }

  /**
   * One row per (recipient, channel) — and for push, one row PER DEVICE.
   *
   * That per-device split is the entire reason `devices` is a table rather than
   * a column: a driver carrying a phone and a tablet must be reached on both,
   * and collapsing them to a single delivery would silently drop every device
   * after the first.
   */
  private deliveryRowsFor(
    eventId: string,
    trigger: RegisteredTrigger<never>,
    recipient: Recipient,
  ): Array<typeof notificationDeliveries.$inferInsert> {
    const recipientKey = `${recipient.subjectType}:${recipient.subjectId}`;
    const suppressed = this.preferences.suppresses(recipient, trigger);
    const rows: Array<typeof notificationDeliveries.$inferInsert> = [];

    for (const channel of trigger.channels) {
      const base = { eventId, recipientKey, channel };

      if (suppressed) {
        rows.push({ ...base, status: 'skipped', skipReason: suppressed });
        continue;
      }

      if (!this.env.NOTIFY_ENABLED) {
        rows.push({ ...base, status: 'skipped', skipReason: 'notifications_disabled' });
        continue;
      }

      if (channel === 'push') {
        if (recipient.pushTokens.length === 0) {
          rows.push({ ...base, status: 'skipped', skipReason: 'no_push_target' });
          continue;
        }
        for (const device of recipient.pushTokens) {
          rows.push({
            ...base,
            deviceId: device.deviceId,
            destination: maskDestination(device.token),
            status: 'queued',
          });
        }
        continue;
      }

      const address = channel === 'email' ? recipient.email : recipient.mobile;
      if (!address) {
        rows.push({ ...base, status: 'skipped', skipReason: 'no_address' });
        continue;
      }
      rows.push({ ...base, destination: maskDestination(address), status: 'queued' });
    }

    return rows;
  }

  // -------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------

  async deliver(channel: NotificationChannel, deliveryId: string): Promise<void> {
    // COMPARE-AND-SET, not a plain read. BullMQ is at-least-once, and without
    // this a redelivered job makes a SECOND vendor call — the row-level
    // idempotency of `uq_notification_deliveries_*` protects the table, not the
    // person's phone.
    const [claimed] = await this.db
      .update(notificationDeliveries)
      .set({
        status: 'sending',
        attempts: sql`${notificationDeliveries.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationDeliveries.id, deliveryId),
          inArray(notificationDeliveries.status, ['queued', 'failed']),
        ),
      )
      .returning();

    if (!claimed) return;

    const [event] = await this.db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.id, claimed.eventId))
      .limit(1);

    const trigger = event ? TRIGGERS_BY_EVENT.get(event.event) : undefined;
    if (!event || !trigger) {
      await this.markFailed(deliveryId, 'no registered trigger for this delivery');
      return;
    }

    const recipient = await this.recipientFor(claimed.recipientKey, trigger, event.payload);
    if (!recipient) {
      await this.markFailed(deliveryId, 'recipient no longer resolvable');
      return;
    }

    // The RAW address is read here and passed to the adapter; it is never
    // persisted. `notification_deliveries.destination` holds a masked copy,
    // because that table has no retention purge until Phase 20 and a push
    // token is a live delivery capability rather than an identifier.
    const to = await this.rawDestination(channel, claimed.deviceId, recipient);
    if (!to) {
      await this.markFailed(deliveryId, 'address disappeared between fan-out and delivery');
      return;
    }

    const variables = asVariables(trigger)(event.payload, recipient);
    const template = TEMPLATES[trigger.template as TemplateKey];

    // `notificationId` must be the INBOX row's id, not this delivery's — a tap
    // marks exactly that row read, and one inbox row fans out to several
    // deliveries (three channels, two devices). `emit()` wrote it in the same
    // transaction as the event, so it is always there for a real subject; the
    // ops pseudo-subject has no bell and therefore no row.
    const [inbox] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.eventId, event.id),
          eq(notifications.subjectType, recipient.subjectType),
          eq(notifications.subjectId, recipient.subjectId),
        ),
      )
      .limit(1);

    // §12.2's attachment, resolved HERE rather than in the registry: the
    // registry is pure data and has no storage port, and it must not carry a
    // megabyte of PDF through a `defineTrigger` literal. EMAIL ONLY — there is
    // nothing to attach a file to on push, SMS or WhatsApp.
    const attachments =
      channel === 'email' ? await this.resolveAttachments(trigger, event.payload) : undefined;

    const result = await this.notifications.notify(channel, {
      to,
      rendered: renderTemplate(trigger.template as TemplateKey, variables),
      templateKey: trigger.template,
      dltTemplateId: template.dltTemplateId,
      waTemplateName: template.waTemplateName,
      variables,
      priority: trigger.priority ?? 'normal',
      data: buildPushData(event.event, trigger, inbox?.id ?? claimed.id),
      androidChannelId: trigger.priority === 'high' ? 'job-offer-v1' : undefined,
      attachments,
      deliveryId: claimed.id,
    });

    if (result.ok) {
      await this.db
        .update(notificationDeliveries)
        .set({
          status: 'sent',
          vendor: result.vendor,
          vendorRef: result.vendorRef,
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(notificationDeliveries.id, deliveryId));

      // Only Expo has a receipts endpoint, and only a real ticket is pollable.
      if (channel === 'push' && result.vendor === 'expo' && result.vendorRef) {
        await this.queue.enqueue(
          'notifications.push-receipts',
          { deliveryIds: [deliveryId] },
          { jobId: `receipts:${deliveryId}`, delayMs: this.env.EXPO_RECEIPT_DELAY_MS },
        );
      }
      return;
    }

    await this.db
      .update(notificationDeliveries)
      .set({
        status: 'failed',
        vendor: result.vendor,
        lastError: `${result.code}: ${result.message}`,
        updatedAt: new Date(),
      })
      .where(eq(notificationDeliveries.id, deliveryId));

    // A dead token is not a transient failure. Revoke the device rather than
    // burning the retry budget on an app somebody uninstalled.
    if (result.code === 'DeviceNotRegistered' && claimed.deviceId) {
      await this.revokeDevice(claimed.deviceId, 'push_token_dead');
    }

    // Throwing is what hands the job back to BullMQ for its retry ladder, and
    // ultimately to the DLQ. A permanent failure must NOT throw — there is
    // nothing to retry and a human triaging an uninstalled app is waste.
    if (result.retryable) {
      throw new Error(`${channel} delivery ${deliveryId} failed: ${result.code}`);
    }
  }

  // -------------------------------------------------------------------------
  // Receipts + sweep
  // -------------------------------------------------------------------------

  /**
   * The half of the push contract the send path cannot see: Expo reports
   * `DeviceNotRegistered` from `getReceipts`, minutes later, not in the ticket.
   * Without this, tokens for uninstalled apps accumulate forever.
   */
  async reconcileReceipts(deliveryIds: string[]): Promise<void> {
    if (deliveryIds.length === 0) return;

    const rows = await this.db
      .select({
        id: notificationDeliveries.id,
        vendorRef: notificationDeliveries.vendorRef,
        deviceId: notificationDeliveries.deviceId,
      })
      .from(notificationDeliveries)
      .where(inArray(notificationDeliveries.id, deliveryIds));

    const byTicket = new Map(
      rows.filter((r) => r.vendorRef).map((r) => [r.vendorRef as string, r]),
    );
    if (byTicket.size === 0) return;

    const receipts = await this.expo.receipts([...byTicket.keys()]);

    for (const [ticketId, receipt] of Object.entries(receipts)) {
      const row = byTicket.get(ticketId);
      if (!row || receipt.status !== 'error') continue;

      await this.db
        .update(notificationDeliveries)
        .set({
          status: 'failed',
          lastError: `${receipt.details?.error ?? 'receipt_error'}: ${receipt.message ?? ''}`,
          updatedAt: new Date(),
        })
        .where(eq(notificationDeliveries.id, row.id));

      if (receipt.details?.error === 'DeviceNotRegistered' && row.deviceId) {
        await this.revokeDevice(row.deviceId, 'push_token_dead');
      }
    }
  }

  /**
   * Repairs the two windows a crash can strand work in: an event committed but
   * never enqueued, and a delivery row written but never picked up. Both are
   * invisible without this — the rows simply sit there, and the §12.3 alarm
   * counts nothing because nothing failed.
   */
  async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - this.env.NOTIFY_STRANDED_MINUTES * 60_000);

    const stranded = await this.db
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(
        and(isNull(notificationEvents.fannedOutAt), lt(notificationEvents.createdAt, cutoff)),
      )
      .limit(200);

    for (const event of stranded) {
      await this.queue.enqueue(
        'notifications.fanout',
        { eventId: event.id },
        { jobId: `fanout:retry:${event.id}` },
      );
    }

    const queued = await this.db
      .select({ id: notificationDeliveries.id, channel: notificationDeliveries.channel })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.status, 'queued'),
          lt(notificationDeliveries.createdAt, cutoff),
        ),
      )
      .limit(500);

    for (const row of queued) {
      const { attempts, backoffMs } = RETRY[row.channel];
      await this.queue.enqueue(
        DELIVER_JOB[row.channel],
        { deliveryId: row.id },
        { jobId: `deliver:retry:${row.id}`, attempts, backoffMs },
      );
    }

    if (stranded.length > 0 || queued.length > 0) {
      this.logger.warn(
        `sweep re-enqueued ${stranded.length} stranded events and ${queued.length} stranded deliveries`,
      );
    }
  }

  // -------------------------------------------------------------------------

  private async recipientFor(
    recipientKey: string,
    trigger: RegisteredTrigger<never>,
    payload: Record<string, unknown>,
  ): Promise<Recipient | null> {
    const recipients = await asResolve(trigger)(payload, {
      db: this.db,
      resolver: this.resolver,
    });
    return recipients.find((r) => `${r.subjectType}:${r.subjectId}` === recipientKey) ?? null;
  }

  private async rawDestination(
    channel: NotificationChannel,
    deviceId: string | null,
    recipient: Recipient,
  ): Promise<string | null> {
    if (channel === 'push') {
      return recipient.pushTokens.find((d) => d.deviceId === deviceId)?.token ?? null;
    }
    return channel === 'email' ? recipient.email : recipient.mobile;
  }

  /**
   * Fetches what a trigger declared it wanted attached.
   *
   * BEST-EFFORT, DELIBERATELY. An invoice that cannot be read is a worse email,
   * not a failed delivery — the customer still gets the receipt telling them
   * the trip is paid, and the app can still download the PDF. Failing the whole
   * send because a blob store hiccuped would turn a cosmetic problem into a
   * missing notification.
   */
  private async resolveAttachments(
    trigger: { attachmentsFor?: (payload: never) => AttachmentRef },
    payload: Record<string, unknown>,
  ): Promise<ChannelSendParams['attachments']> {
    if (!trigger.attachmentsFor) return undefined;

    if (!this.attachmentResolver) return undefined;

    try {
      const resolved = await this.attachmentResolver.resolve(trigger.attachmentsFor(payload as never));
      return resolved.length > 0 ? resolved : undefined;
    } catch (error) {
      this.logger.warn(`attachment could not be resolved: ${String(error)}`);
      return undefined;
    }
  }

  private async markFailed(deliveryId: string, reason: string): Promise<void> {
    await this.db
      .update(notificationDeliveries)
      .set({ status: 'failed', lastError: reason, updatedAt: new Date() })
      .where(eq(notificationDeliveries.id, deliveryId));
  }

  private async revokeDevice(deviceId: string, reason: string): Promise<void> {
    await this.db
      .update(devices)
      .set({ revokedAt: new Date(), revokedReason: reason, pushToken: null, updatedAt: new Date() })
      .where(eq(devices.id, deviceId));
    this.logger.log(`revoked device ${deviceId} (${reason})`);
  }
}

/** Mirrors `pushDataPayloadSchema` exactly — the shared discriminator is `event`. */
function buildPushData(
  event: string,
  trigger: RegisteredTrigger<never>,
  deliveryId: string,
): Record<string, string> {
  const data: Record<string, string> = {
    event,
    notificationId: deliveryId,
    action: trigger.push?.action ?? 'open',
  };
  if (trigger.push?.invalidate) data.invalidate = trigger.push.invalidate;
  if (trigger.push?.route) data.route = trigger.push.route;
  return data;
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
