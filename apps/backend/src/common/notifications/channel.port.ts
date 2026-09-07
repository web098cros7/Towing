import type { NotificationChannel } from '@towing/api-contracts';

/**
 * ONE PORT PER CHANNEL, four separate DI tokens — not one
 * `NOTIFICATION_PROVIDER` switch.
 *
 * The four channels' credentials arrive at four different times: Firebase and
 * SES production access are independent procurement items, MSG91 needs DLT
 * template registration, WhatsApp needs a BSP plus Meta template approval. A
 * single switch would make going live all-or-nothing — you could not run real
 * FCM while SMS is still on the log adapter, which is the state this project
 * will be in for months. Each token is bound by its own `NOTIFY_*_PROVIDER`
 * env var through the `money.module.ts` `useFactory` idiom.
 */

export const PUSH_CHANNEL = Symbol('PUSH_CHANNEL');
export const SMS_CHANNEL = Symbol('SMS_CHANNEL');
export const WHATSAPP_CHANNEL = Symbol('WHATSAPP_CHANNEL');
export const EMAIL_CHANNEL = Symbol('EMAIL_CHANNEL');

/** Already rendered by the template catalog. Adapters never render. */
export interface RenderedMessage {
  /** Push/inbox title and WhatsApp header. Null for SMS, which has no title concept. */
  title: string | null;
  body: string;
  /** Email only. */
  subject: string | null;
}

export interface ChannelSendParams {
  /**
   * E.164 phone, email address, or Expo push token.
   *
   * NEVER a UUID. This value can only be produced by a trigger's `resolve()` —
   * that is the whole point of the registry, and it is invariant 69. Two
   * pre-Phase-13 call sites passed a subject id into a field documented as an
   * address; harmless against the log adapter, silent non-delivery the instant
   * a real one bound.
   */
  to: string;
  rendered: RenderedMessage;
  /** Catalog key, e.g. `driver_kyc_approved`. Carried for logging and metrics. */
  templateKey: string;
  /** DLT-registered id. Null until MSG91 registration lands (`ToBeDoneEhsan.md`). */
  dltTemplateId: string | null;
  /** WhatsApp Cloud API template name. Null until BSP approval lands. */
  waTemplateName: string | null;
  /** Template variables, for providers that take them positionally or by name. */
  variables: Record<string, string>;
  /**
   * §12.3: `high` bypasses notification batching and uses the dedicated Android
   * channel. Phase 17's `job:offer` is the first real user; the transport is
   * built and exercised here so it is not new code on the day a 20-second offer
   * window depends on it.
   */
  priority: 'normal' | 'high';
  /** Data-only payload — see `pushDataPayloadSchema`. Push channel only. */
  data: Record<string, string>;
  /** Android channel id for `priority: 'high'`. See TowPartner's `job-offer-v1`. */
  androidChannelId?: string;
  /**
   * §12.2's invoice attachment. EMAIL ONLY — push, SMS and WhatsApp adapters
   * ignore it, because there is nothing to attach it to.
   *
   * Carried as bytes rather than a link because §14.2 asks for an invoice, and
   * a customer forwarding one to their insurer wants a file rather than a URL
   * that expires. `SesEmailAdapter` switches from `Content.Simple` to
   * `Content.Raw` when this is present — a MIME multipart it builds by hand,
   * because pulling in `nodemailer` for that would be an entire SMTP stack for
   * a boundary string.
   */
  attachments?: Array<{ filename: string; contentType: string; content: Buffer }>;
  /** The `notification_deliveries.id` this send belongs to — the correlation id. */
  deliveryId: string;
}

/**
 * Adapters RETURN their outcome rather than throwing it.
 *
 * The worker needs "retryable vs permanent" as data. A thrown error loses that
 * distinction once BullMQ serialises it, and the distinction is load-bearing:
 * Expo's `DeviceNotRegistered` must mark the row permanently failed and revoke
 * the device, not burn five attempts and land in a DLQ that a human then
 * triages for an app somebody uninstalled.
 *
 * A genuine programming error still throws — that is a bug, not a delivery
 * outcome, and it should reach the DLQ.
 */
export type ChannelResult =
  | { ok: true; vendor: string; vendorRef: string | null }
  | { ok: false; vendor: string; retryable: boolean; code: string; message: string };

export interface ChannelPort {
  /** Metric label and `ExternalCallPolicy` breaker key: `log`|`expo`|`msg91`|`whatsapp_cloud`|`ses`. */
  readonly vendor: string;
  readonly channel: NotificationChannel;
  send(params: ChannelSendParams): Promise<ChannelResult>;
}
