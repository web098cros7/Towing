import { z } from 'zod';
import { notificationChannelSchema } from '../common/notifications';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';

/**
 * W18 — the notification console (§12.3), `/admin/settings/notifications`.
 *
 * READ-ONLY TEMPLATES, BY DESIGN. The catalogue file's header argues the case:
 * SMS bodies are DLT-registered with the regulator and WhatsApp bodies are
 * approved by Meta, both referenced by an id the provider issues — a runtime
 * editor would desynchronise what we send from what was approved. This API
 * exposes the catalogue, its variable order and WHICH CHANNELS CANNOT SEND
 * (a null provider template id), and nothing here accepts a body.
 *
 * THE TEST-SEND HAS NO DESTINATION FIELD. Its body names a channel and a
 * template; the destination is always the CALLING admin's own mobile/email,
 * read server-side. A "send a test to this address" input is a spam cannon
 * pointed at whoever the operator types, and the feature does not need one.
 */

/** The two channels whose catalog entry can make them unsendable. */
export const NOTIFICATION_UNUSABLE_CHANNELS = ['sms', 'whatsapp'] as const;
export const notificationUnusableChannelSchema = z.enum(NOTIFICATION_UNUSABLE_CHANNELS);

export const adminNotificationTemplateSchema = z.object({
  templateKey: z.string(),
  /** Every trigger that emits it, in registry order. Empty when the template waits for a producer. */
  events: z.array(z.string()),
  /** The MATRIX_12_2 rows those triggers claim (blank rows omitted). */
  matrixRows: z.array(z.string()),
  /** The channels the triggers fan out on (their union). Empty when no trigger is bound yet. */
  channels: z.array(notificationChannelSchema),
  /** Channels that physically cannot send: their provider template id is null. */
  unusableChannels: z.array(notificationUnusableChannelSchema),
  dltTemplateId: z.string().nullable(),
  waTemplateName: z.string().nullable(),
  /** Positional parameter order for providers that take {{1}}, {{2}}… */
  orderedVariables: z.array(z.string()),
  /** Rendered with EMPTY variables — the fallbacks IN the template, not placeholders. */
  sampleTitle: z.string().nullable(),
  sampleBody: z.string(),
  sampleSubject: z.string().nullable(),
  category: z.string().nullable(),
  alwaysOn: z.boolean().nullable(),
});
export type AdminNotificationTemplate = z.infer<typeof adminNotificationTemplateSchema>;

export const adminNotificationTemplatesResponseSchema = z.object({
  items: z.array(adminNotificationTemplateSchema),
});
export type AdminNotificationTemplatesResponse = z.infer<
  typeof adminNotificationTemplatesResponseSchema
>;

export const NOTIFICATION_DELIVERY_STATUSES = [
  'queued',
  'sending',
  'sent',
  'failed',
  'skipped',
] as const;
export const notificationDeliveryStatusSchema = z.enum(NOTIFICATION_DELIVERY_STATUSES);

export const NOTIFICATION_SKIP_REASONS = [
  'no_address',
  'no_push_target',
  'suppressed_by_pref',
  'notifications_disabled',
] as const;
export const notificationSkipReasonSchema = z.enum(NOTIFICATION_SKIP_REASONS);

/** `destination` arrives MASKED — it is stored that way (W14's masking rule). */
export const adminNotificationDeliverySchema = z.object({
  id: z.uuid(),
  event: z.string(),
  recipientKey: z.string(),
  channel: notificationChannelSchema,
  status: notificationDeliveryStatusSchema,
  skipReason: notificationSkipReasonSchema.nullable(),
  destination: z.string().nullable(),
  vendor: z.string().nullable(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  sentAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminNotificationDelivery = z.infer<typeof adminNotificationDeliverySchema>;

export const adminNotificationDeliveriesQuerySchema = pageQuerySchema.extend({
  status: notificationDeliveryStatusSchema.optional(),
  channel: notificationChannelSchema.optional(),
  event: z.string().trim().max(64).optional(),
});
export type AdminNotificationDeliveriesQuery = z.infer<
  typeof adminNotificationDeliveriesQuerySchema
>;

export const adminNotificationDeliveriesResponseSchema = pageEnvelopeSchema(
  adminNotificationDeliverySchema,
).extend({
  /** Sum of `failed` across the notification queues only (fan-out and the four delivery queues) — §12.3's DLQ depth, live. */
  deadLetterDepth: z.number().int(),
});
export type AdminNotificationDeliveriesResponse = z.infer<
  typeof adminNotificationDeliveriesResponseSchema
>;

export const NOTIFICATION_TEST_CHANNELS = ['sms', 'email', 'whatsapp'] as const;
export const notificationTestChannelSchema = z.enum(NOTIFICATION_TEST_CHANNELS);

export const adminNotificationTestSendSchema = z.object({
  channel: notificationTestChannelSchema,
  templateKey: z.string().trim().min(1).max(80),
});
export type AdminNotificationTestSend = z.infer<typeof adminNotificationTestSendSchema>;

export const adminNotificationTestSendResponseSchema = z.object({
  sent: z.boolean(),
  channel: notificationTestChannelSchema,
  /** Masked — the console never renders a full address, not even its own. */
  destination: z.string(),
  /** The provider's refusal code when `sent` is false (e.g. `dlt_template_missing`). */
  code: z.string().nullable(),
});
export type AdminNotificationTestSendResponse = z.infer<
  typeof adminNotificationTestSendResponseSchema
>;
