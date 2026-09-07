import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../test/app';
import {
  ATTACHMENT_RESOLVER,
  type AttachmentResolverPort,
} from '../../common/notifications/attachment.port';
import { NotificationDispatcherService } from '../../common/notifications/notification-dispatcher.service';
import { TRIGGERS_BY_EVENT } from '../../common/notifications/registry/triggers';
import { buildRawEmail } from '../../common/notifications/channels/ses-email.adapter';

/**
 * §12.2's invoice attachment, wired end to end.
 *
 * THIS FILE EXISTS BECAUSE THE FAILURE MODE IS SILENT. The resolver is bound
 * through an OPTIONAL injection token, which means a missing binding compiles,
 * boots, passes every other test, and simply sends every invoice email with no
 * attachment for the rest of time. That is precisely the class of defect Phase
 * 18 shipped twice (two modules that never exported what another injected), and
 * `tsc` cannot see any of it.
 */
describe('invoice attachment wiring', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('the ATTACHMENT_RESOLVER token is actually bound', () => {
    // `InvoicesModule` is `@Global()` for exactly this. Without it the token
    // would resolve to `undefined` in the notification spine's module scope.
    const resolver = app.get<AttachmentResolverPort>(ATTACHMENT_RESOLVER, { strict: false });
    expect(resolver).toBeDefined();
    expect(typeof resolver.resolve).toBe('function');
  });

  it('the dispatcher received it, rather than silently going without', () => {
    const dispatcher = app.get(NotificationDispatcherService);
    // Reaching into the private field on purpose: the whole point is that this
    // is a wiring fact no public surface reports.
    const injected = (dispatcher as unknown as { attachmentResolver?: unknown }).attachmentResolver;
    expect(injected).toBeDefined();
  });

  it('the completed-invoice trigger declares an attachment', () => {
    const trigger = TRIGGERS_BY_EVENT.get('booking.completed_invoice');
    expect(trigger).toBeDefined();
    expect(trigger?.attachmentsFor).toBeTypeOf('function');
    expect(trigger?.attachmentsFor?.({ bookingId: 'abc12345-0000-0000-0000-000000000000' } as never)).toEqual({
      kind: 'invoice',
      bookingId: 'abc12345-0000-0000-0000-000000000000',
    });
  });

  it('no OTHER trigger declares one', () => {
    // A second attachment producer would need a second `AttachmentRef` kind,
    // and the resolver returns `[]` for anything it does not recognise — which
    // would be another silent no-attachment. Pinning the list makes adding one
    // a deliberate act.
    const withAttachments = [...TRIGGERS_BY_EVENT.values()]
      .filter((trigger) => trigger.attachmentsFor)
      .map((trigger) => trigger.event);

    expect(withAttachments).toEqual(['booking.completed_invoice']);
  });

  describe('the MIME builder', () => {
    it('produces a multipart message with a base64 attachment', () => {
      const raw = Buffer.from(
        buildRawEmail({
          from: 'no-reply@mitow.test',
          to: 'customer@example.test',
          subject: 'Invoice for booking TW-3F9A21B4',
          body: 'Your invoice is attached.',
          attachments: [
            {
              filename: 'invoice-INV-3F9A21B4.pdf',
              contentType: 'application/pdf',
              content: Buffer.from('%PDF-1.7\nfake'.repeat(20)),
            },
          ],
        }),
      ).toString('utf8');

      expect(raw).toContain('MIME-Version: 1.0');
      expect(raw).toContain('Content-Type: multipart/mixed; boundary="');
      expect(raw).toContain('Content-Disposition: attachment; filename="invoice-INV-3F9A21B4.pdf"');
      expect(raw).toContain('Content-Transfer-Encoding: base64');
      // RFC 5322 wants CRLF, and some MTAs enforce it.
      expect(raw).toContain('\r\n');
    });

    it('wraps base64 at 76 characters, per RFC 2045', () => {
      // THE PART MOST LIKELY TO BE WRONG AND LEAST LIKELY TO BE NOTICED:
      // forgiving clients accept longer lines, so an unwrapped body would work
      // everywhere except somewhere that matters.
      const raw = Buffer.from(
        buildRawEmail({
          from: 'a@b.test',
          to: 'c@d.test',
          subject: 'x',
          body: 'y',
          attachments: [
            {
              filename: 'big.pdf',
              contentType: 'application/pdf',
              content: Buffer.alloc(4096, 0x41),
            },
          ],
        }),
      ).toString('utf8');

      const base64Lines = raw
        .split('\r\n')
        .filter((line) => /^[A-Za-z0-9+/=]{20,}$/.test(line));

      expect(base64Lines.length).toBeGreaterThan(10);
      for (const line of base64Lines) expect(line.length).toBeLessThanOrEqual(76);
    });

    it('encodes a non-ASCII subject as an RFC 2047 encoded-word', () => {
      const raw = Buffer.from(
        buildRawEmail({
          from: 'a@b.test',
          to: 'c@d.test',
          subject: 'Facturé ₹2,000',
          body: 'x',
          attachments: [],
        }),
      ).toString('utf8');

      expect(raw).toContain('Subject: =?UTF-8?B?');
      // The raw glyph must not appear unencoded in a header.
      expect(raw.split('\r\n\r\n')[0]).not.toContain('₹');
    });
  });
});
