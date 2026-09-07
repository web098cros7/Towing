import { Injectable } from '@nestjs/common';
import type {
  AttachmentResolverPort,
  ResolvedAttachment,
} from '../../common/notifications/attachment.port';
import type { AttachmentRef } from '../../common/notifications/registry/trigger.types';
import { InvoiceService } from './invoice.service';

/**
 * Turns §12.2's `{ kind: 'invoice', bookingId }` into actual bytes.
 *
 * `ensure()` rather than a bare read, so an email that arrives before the
 * queued `invoice.generate` job has run still carries the PDF — and carries
 * THE SAME PDF the app will later download, because both go through the one
 * idempotent generator.
 */
@Injectable()
export class InvoiceAttachmentResolver implements AttachmentResolverPort {
  constructor(private readonly invoices: InvoiceService) {}

  async resolve(ref: AttachmentRef): Promise<ResolvedAttachment[]> {
    if (ref.kind !== 'invoice') return [];

    return [
      {
        // The same code the document prints in its own header, so a customer
        // quoting "INV-3F9A21B4" and the file on their disk agree.
        filename: `invoice-INV-${ref.bookingId.slice(0, 8).toUpperCase()}.pdf`,
        contentType: 'application/pdf',
        content: await this.invoices.bytes(ref.bookingId),
      },
    ];
  }
}
