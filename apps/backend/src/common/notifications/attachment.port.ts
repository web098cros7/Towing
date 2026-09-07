import type { AttachmentRef } from './registry/trigger.types';

export interface ResolvedAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

/**
 * The seam between a trigger's DECLARATION that it wants a file attached and
 * the module that can actually produce one.
 *
 * WHY A PORT RATHER THAN AN IMPORT. `common/notifications` is infrastructure
 * and `modules/invoices` is a domain; having the dispatcher import
 * `InvoiceService` would point the dependency backwards and make the
 * notification spine — which every phase from 13 onward builds on — depend on
 * a document renderer added in Phase 19.
 *
 * OPTIONAL BY DESIGN. A deployment with no attachment producer bound simply
 * sends emails without files, which is the correct degraded behaviour: a
 * receipt that says the trip is paid is still worth sending when the PDF is
 * unavailable.
 */
export interface AttachmentResolverPort {
  resolve(ref: AttachmentRef): Promise<ResolvedAttachment[]>;
}

export const ATTACHMENT_RESOLVER = Symbol('ATTACHMENT_RESOLVER');
