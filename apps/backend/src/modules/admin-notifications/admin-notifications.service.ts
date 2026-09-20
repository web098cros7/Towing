import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminNotificationDeliveriesQuery,
  type AdminNotificationDeliveriesResponse,
  type AdminNotificationTemplate,
  type AdminNotificationTemplatesResponse,
  type AdminNotificationTestSend,
  type AdminNotificationTestSendResponse,
} from '@towing/api-contracts';
import { eq, sql, type SQL } from 'drizzle-orm';
import { maskDestination } from '../../common/notifications/channels/log-channel.adapter';
import { NotificationService } from '../../common/notifications/notification.service';
import {
  TEMPLATES,
  renderTemplate,
  type TemplateKey,
} from '../../common/notifications/template-catalog';
import {
  REGISTERED_TRIGGERS,
} from '../../common/notifications/registry/triggers';
import type { RegisteredTrigger } from '../../common/notifications/registry/trigger.types';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { adminUsers } from '../../db/schema';
import { AdminAuditService } from '../admin-auth/admin-audit.service';

/**
 * W18's reads and the one guarded write (§12.3).
 *
 * TEMPLATES COME FROM CODE, NOT A TABLE. `template-catalog.ts` is the source
 * of truth and the trigger registry says who emits what; this service joins
 * the two so the console can answer the operationally useful half — WHICH
 * CHANNELS ARE UNUSABLE RIGHT NOW because their provider template id is null.
 * Today that is every SMS and WhatsApp row (DLT and Meta approvals pending,
 * `ToBeDoneEhsan.md`), and the screen says so instead of implying delivery.
 *
 * DELIVERIES ARE READ MASKED, AS STORED. `notification_deliveries.destination`
 * has carried only the masked form since W14; there is nothing to redact here
 * because the raw address never reached the table.
 *
 * THE TEST-SEND CANNOT TARGET ANYONE BUT THE CALLER: no destination field
 * exists in the body (`admin/notifications.ts` argues why), and the address is
 * read from the caller's own admin row. It goes through
 * `NotificationService.sendPreview` rather than injecting the transport: the
 * port token may not leave `common/notifications` (`notification-port-usage.spec.ts`,
 * invariant 69, which is a source-text scan with no comment stripping — so this
 * paragraph may not spell it either), and the seam is where that exemption is
 * argued once rather than reopened per module.
 */
@Injectable()
export class AdminNotificationsService {
  /** templateKey → the trigger that emits it (first wins; keys are unique in practice). */
  private readonly triggerByTemplate = new Map<string, RegisteredTrigger<never>>(
    REGISTERED_TRIGGERS.map((trigger) => [trigger.template, trigger]),
  );

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
    private readonly notifications: NotificationService,
    private readonly audit: AdminAuditService,
  ) {}

  templates(): AdminNotificationTemplatesResponse {
    const items: AdminNotificationTemplate[] = (
      Object.keys(TEMPLATES) as TemplateKey[]
    ).map((key) => {
      const definition = TEMPLATES[key];
      const trigger = this.triggerByTemplate.get(key);
      const rendered = renderTemplate(key, {});

      const unusableChannels: AdminNotificationTemplate['unusableChannels'] = [];
      if (definition.dltTemplateId === null && trigger?.channels.includes('sms')) {
        unusableChannels.push('sms');
      }
      if (definition.waTemplateName === null && trigger?.channels.includes('whatsapp')) {
        unusableChannels.push('whatsapp');
      }

      return {
        templateKey: key,
        event: trigger?.event ?? null,
        matrixRow: trigger?.matrixRow ? trigger.matrixRow : null,
        channels: trigger ? [...trigger.channels] : [],
        unusableChannels,
        dltTemplateId: definition.dltTemplateId,
        waTemplateName: definition.waTemplateName,
        orderedVariables: [...definition.orderedVariables],
        sampleTitle: rendered.title,
        sampleBody: rendered.body,
        sampleSubject: rendered.subject ?? null,
        category: trigger ? trigger.category : null,
        alwaysOn: trigger ? trigger.alwaysOn : null,
      } satisfies AdminNotificationTemplate;
    });

    return { items };
  }

  async deliveries(query: AdminNotificationDeliveriesQuery): Promise<AdminNotificationDeliveriesResponse> {
    const filters: SQL[] = [];
    if (query.status) filters.push(sql`d.status = ${query.status}`);
    if (query.channel) filters.push(sql`d.channel = ${query.channel}`);
    if (query.event) filters.push(sql`e.event = ${query.event}`);
    const where = filters.length > 0 ? sql.join(filters, sql` and `) : sql`true`;

    const offset = (query.page - 1) * query.limit;
    const rows = (await this.db.execute(sql`
      select d.id, e.event, d.recipient_key, d.channel, d.status, d.skip_reason,
             d.destination, d.vendor, d.attempts, d.last_error, d.sent_at, d.created_at,
             count(*) over() as total_count
        from notification_deliveries d
        join notification_events e on e.id = d.event_id
       where ${where}
       order by d.created_at desc, d.id desc
       limit ${query.limit} offset ${offset}
    `)) as unknown as Array<Record<string, unknown>>;

    const stats = await this.queue.stats();
    const deadLetterDepth = stats.reduce((total, queue) => total + queue.failed, 0);

    return {
      items: rows.map((row) => ({
        id: row.id as string,
        event: row.event as string,
        recipientKey: row.recipient_key as string,
        channel: row.channel as AdminNotificationDeliveriesResponse['items'][number]['channel'],
        status: row.status as AdminNotificationDeliveriesResponse['items'][number]['status'],
        skipReason:
          (row.skip_reason as AdminNotificationDeliveriesResponse['items'][number]['skipReason']) ??
          null,
        destination: (row.destination as string | null) ?? null,
        vendor: (row.vendor as string | null) ?? null,
        attempts: Number(row.attempts),
        lastError: (row.last_error as string | null) ?? null,
        sentAt: row.sent_at ? new Date(row.sent_at as string).toISOString() : null,
        createdAt: new Date(row.created_at as string).toISOString(),
      })),
      page: query.page,
      limit: query.limit,
      total: rows[0] ? Number(rows[0].total_count) : 0,
      deadLetterDepth,
    };
  }

  async testSend(adminId: string, body: AdminNotificationTestSend): Promise<AdminNotificationTestSendResponse> {
    const key = body.templateKey as TemplateKey;
    const definition = TEMPLATES[key];
    if (!definition) {
      throw ApiException.validation('Unknown template', { templateKey: body.templateKey });
    }

    const [admin] = await this.db
      .select({ email: adminUsers.email, mobile: adminUsers.mobile })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId))
      .limit(1);
    if (!admin) throw ApiException.unauthorized();

    const destination = body.channel === 'email' ? admin.email : admin.mobile;
    if (!destination) {
      throw ApiException.validation(
        body.channel === 'email'
          ? 'Your admin record has no email on file'
          : 'Your admin record has no mobile number on file',
        { channel: body.channel },
      );
    }

    const result = await this.notifications.sendPreview({
      channel: body.channel,
      to: destination,
      rendered: renderTemplate(key, {}),
      templateKey: key,
      dltTemplateId: definition.dltTemplateId,
      waTemplateName: definition.waTemplateName,
    });

    const masked = maskDestination(destination);
    await this.audit.record({
      adminId,
      action: 'notification.test_send',
      subjectType: 'notification_template',
      subjectId: null,
      before: null,
      after: {
        channel: body.channel,
        templateKey: key,
        destination: masked,
        sent: result.ok,
        code: result.ok ? null : result.code,
      },
      reason: 'Guarded test-send to the caller’s own contact',
    });

    return {
      sent: result.ok,
      channel: body.channel,
      destination: masked,
      code: result.ok ? null : result.code,
    };
  }
}
