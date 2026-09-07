import { Controller, Get, Global, Module, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { InvoiceLinkDto } from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ZodParam } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { ATTACHMENT_RESOLVER } from '../../common/notifications/attachment.port';
import { InvoiceAttachmentResolver } from './invoice-attachment.resolver';
import { InvoiceService } from './invoice.service';

/** §9.1.10's "invoice (PDF) download". */
@Controller('bookings')
@UseGuards(JwtAuthGuard)
@Realms('customer')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get(':id/invoice')
  invoice(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<InvoiceLinkDto> {
    const auth = request.auth;
    if (!auth) throw ApiException.unauthorized();
    return this.invoices.link(bookingId, auth.sub);
  }
}

/**
 * §14.2's invoice.
 *
 * Its own module rather than a corner of `MoneyModule`, because generation is a
 * DOCUMENT concern and everything it needs is already `@Global()` — the storage
 * port, the queue, the database. `MoneyModule` imports it only for the email
 * attachment, which keeps the dependency pointing one way.
 */
/**
 * §@Global@ SOLELY FOR THE ATTACHMENT PORT, and it is load-bearing rather than
 * convenience. `NotificationDispatcherService` lives in the global
 * `NotificationsModule`, and Nest resolves an `@Inject` token from the
 * consumer’s own module, its imports, and globals — nothing else. Without
 * `@Global()` here the binding below would compile, boot, and silently never
 * bind, so every invoice email would go out with no attachment and no error.
 * `invoice-attachment.e2e.spec.ts` asserts it is actually wired.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [InvoiceController],
  providers: [
    InvoiceService,
    // §12.2's attachment seam. Bound HERE rather than in the notification
    // spine, so the dependency points from the domain at the infrastructure
    // and not the other way round.
    { provide: ATTACHMENT_RESOLVER, useClass: InvoiceAttachmentResolver },
  ],
  exports: [InvoiceService, ATTACHMENT_RESOLVER],
})
export class InvoicesModule {}
