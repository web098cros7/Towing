import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { ENV, type Env } from '../../../config/env';
import { ExternalCallPolicy } from '../../http/external-call.policy';
import type { ChannelPort, ChannelResult, ChannelSendParams } from '../channel.port';

/**
 * Amazon SES (§12.1, §12.2's four email-required rows).
 *
 * ⚠ NEVER EXECUTED AGAINST SES. There are no AWS credentials and SES
 * production access is a support-ticket review that has not been raised
 * (`ToBeDoneEhsan.md`). Not one email has been sent by this adapter.
 *
 * WHY `@aws-sdk/client-sesv2` AND NOT A HAND-ROLLED SIGV4 SIGNER. SES's HTTPS
 * API requires SigV4. Hand-writing request-signing crypto for a path that has
 * no credentials and cannot be executed here would ship ~60 lines of security
 * code that passes review as finished and has never once run against the
 * service it signs for — the exact failure mode this repo refuses elsewhere
 * (see `apple-identity.adapter.ts`'s original docstring). The scoped v2 client
 * is one import, stays behind `EMAIL_CHANNEL`, and Phase 9b's S3 adapter and
 * Phase 19's invoice attachment both reuse the same credential chain.
 *
 * The client is constructed LAZILY. The module factory instantiates this class
 * whichever adapter it ends up binding, and an `SESv2Client` built at
 * construction time would resolve the AWS credential chain on every `log` boot
 * — including in CI, where that means an EC2 metadata lookup that hangs.
 */
@Injectable()
export class SesEmailAdapter implements ChannelPort, OnModuleInit {
  readonly vendor = 'ses';
  readonly channel = 'email' as const;

  private readonly logger = new Logger(SesEmailAdapter.name);
  private client: SESv2Client | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly policy: ExternalCallPolicy,
  ) {}

  onModuleInit(): void {
    if (this.env.NOTIFY_EMAIL_PROVIDER !== 'ses') return;
    // `assertProductionSafety` refuses the `.local` placeholder in production.
    if (this.env.SES_FROM_EMAIL.endsWith('.local')) {
      this.logger.warn('NOTIFY_EMAIL_PROVIDER=ses but SES_FROM_EMAIL is still the dev placeholder');
    }
    this.client = new SESv2Client({ region: this.env.SES_REGION });
  }

  async send(params: ChannelSendParams): Promise<ChannelResult> {
    const client = this.client;
    if (!client) {
      return {
        ok: false,
        vendor: this.vendor,
        retryable: false,
        code: 'not_initialised',
        message: 'SES client was never initialised — NOTIFY_EMAIL_PROVIDER is not ses',
      };
    }

    try {
      return await this.policy.run<ChannelResult>(
        {
          vendor: this.vendor,
          attempts: 3,
          backoffMs: 1_000,
          // SES throttling is retryable; a rejected address or an unverified
          // identity is not, and burning three attempts on it only delays the
          // DLQ landing.
          isRetryable: (error) => {
            const name = (error as { name?: string })?.name ?? '';
            return !['MessageRejected', 'MailFromDomainNotVerified', 'AccountSuspendedException']
              .includes(name);
          },
        },
        async () => {
          const subject = params.rendered.subject ?? params.rendered.title ?? '';

          // §12.2's invoice attachment. `Content.Simple` STRUCTURALLY CANNOT
          // carry one — it is a subject and a body and nothing else — so an
          // email with a file switches to `Content.Raw` and a MIME multipart
          // this adapter builds by hand.
          //
          // Deliberately NOT `nodemailer`: that is an entire SMTP stack, a
          // transport layer this code does not use and does not want, pulled in
          // for a boundary string and some base64.
          const content = params.attachments?.length
            ? { Raw: { Data: buildRawEmail({
                from: this.env.SES_FROM_EMAIL,
                to: params.to,
                subject,
                body: params.rendered.body,
                attachments: params.attachments,
              }) } }
            : {
                Simple: {
                  Subject: { Data: subject },
                  Body: { Text: { Data: params.rendered.body } },
                },
              };

          const result = await client.send(
            new SendEmailCommand({
              FromEmailAddress: this.env.SES_FROM_EMAIL,
              Destination: { ToAddresses: [params.to] },
              Content: content,
            }),
          );
          return { ok: true, vendor: this.vendor, vendorRef: result.MessageId ?? null };
        },
      );
    } catch (error) {
      const name = (error as { name?: string })?.name ?? 'transport_error';
      return {
        ok: false,
        vendor: this.vendor,
        retryable: !['MessageRejected', 'MailFromDomainNotVerified'].includes(name),
        code: name,
        message: String(error),
      };
    }
  }
}

/**
 * An RFC 2045 multipart/mixed message, by hand.
 *
 * ⚠ NEVER EXECUTED AGAINST A REAL MTA. No SES credentials exist
 * (SETUP-CHECKLIST item 10), so this has never been sent, never been rendered
 * by Gmail, and its base64 line-wrapping has never been checked by anything but
 * the spec below. The 76-character wrap is the part most likely to be wrong:
 * RFC 2045 requires it and forgiving clients accept longer lines, so a bug here
 * would work everywhere except somewhere that matters.
 */
export function buildRawEmail(params: {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments: Array<{ filename: string; contentType: string; content: Buffer }>;
}): Uint8Array {
  // Deterministic-ish and collision-proof enough: the boundary only has to be a
  // string that does not occur in the body, and this one cannot be typed.
  const boundary = `----mitow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const lines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    // RFC 2047 encoded-word, so a non-ASCII subject survives. Ours are ASCII
    // today; the day one is not is not the day to discover this.
    `Subject: =?UTF-8?B?${Buffer.from(params.subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    params.body,
    '',
  ];

  for (const attachment of params.attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap(attachment.content.toString('base64'), 76),
      '',
    );
  }

  lines.push(`--${boundary}--`, '');

  // CRLF, not LF. RFC 5322 requires it and some MTAs enforce it.
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

/** RFC 2045's 76-character limit on base64 body lines. */
function wrap(value: string, width: number): string {
  const out: string[] = [];
  for (let index = 0; index < value.length; index += width) {
    out.push(value.slice(index, index + width));
  }
  return out.join('\r\n');
}
