import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ErrorCodes } from '@towing/api-contracts';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../../common/errors/api-exception';
import { SkipThrottling } from '../../common/throttling/throttler.config';
import { DB, type Database } from '../../db/db.module';
import {
  PAYOUT_PROVIDER,
  type PayoutProviderPort,
  type PayoutWebhookEvent,
} from '../money/payout-provider.port';
import { PayoutsService } from '../money/payouts.service';
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayPort,
  type PaymentWebhookEvent,
} from '../money/payment-gateway.port';
import { PaymentsService } from '../money/payments.service';
import { RefundsService } from '../money/refunds.service';

/**
 * Vendor webhooks (§19.3: "signature-verified, idempotent, and replayable").
 *
 * **Deliberately NOT under `fleet/`, and with no `JwtAuthGuard`,
 * `FleetScopeGuard` or `@CurrentFleet()`.** Razorpay has no session and cannot
 * be asked to get one; the signature is the authentication.
 *
 * `@SkipThrottling()` for the same reason: a legitimate burst of settlement
 * events must not be rate-limited into retries, and HMAC verification rejects
 * an unsigned request in microseconds before any database work — a better gate
 * than a counter.
 *
 * ⚠ It used to say `@SkipThrottle()`, which had never skipped anything: the
 * library's decorator defaults to `{ default: true }` and the guard matches
 * skip metadata per throttler name, so with buckets named `reads`/`money`/… it
 * matched none of them. Harmless while the tracker was a shared IP and the key
 * included the handler; genuinely dangerous once per-tenant keying put every
 * unauthenticated caller — i.e. all of Razorpay — into one bucket.
 */
@Controller('webhooks')
@SkipThrottling()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProviderPort,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    private readonly payouts: PayoutsService,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
  ) {}

  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  async razorpay(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
  ): Promise<{ received: boolean }> {
    // `rawBody` needs `NestFactory.create(AppModule, { rawBody: true })` — and
    // the same option in BOTH factories in `src/test/app.ts`. Forget the test
    // one and this surfaces as a baffling 401.
    const raw = request.rawBody;
    if (!raw) {
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCodes.INTERNAL,
        'Raw body capture is not enabled — the webhook signature cannot be verified',
      );
    }

    // 1. Verify BEFORE any database write. An unsigned request must not be able
    //    to fill `webhook_events` with rows.
    //
    //    AGAINST BOTH SECRETS, since Phase 19. Razorpay's payment gateway and
    //    RazorpayX Route are configured in separate dashboards and are not
    //    obliged to share a webhook secret — so the endpoint tries each, and a
    //    deployment that DOES share one still works because both succeed.
    //    Payments carry the overwhelming majority of volume, so they go first;
    //    two constant-time HMACs cost microseconds either way.
    const verifiedBy = !signature
      ? null
      : this.gateway.verifyWebhook(raw, signature)
        ? 'payment'
        : this.provider.verifyWebhook(raw, signature)
          ? 'payout'
          : null;

    if (!verifiedBy) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.INVALID_SIGNATURE,
        'Webhook signature verification failed',
      );
    }

    // 2. Parse from the RAW bytes, not `request.body`. One source of truth for
    //    what was signed; no question about parser mutation in between.
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      throw ApiException.validation('Webhook body is not valid JSON');
    }

    // 3. Parse, TRYING BOTH PARSERS whichever secret matched.
    //
    //    THE FIVE-LINE GUARD AGAINST A WHOLE CLASS OF LOST SETTLEMENT. If a
    //    deployment configures both Razorpay products with the SAME webhook
    //    secret — which is normal, and which nothing prevents — then the
    //    payment port verifies every payout event too. Its parser correctly
    //    returns null for `payout.*`, and without this fallback the controller
    //    would 200-and-drop every payout webhook, silently, forever. The
    //    reconcile poll would eventually catch each one, but "eventually, by
    //    polling" is not how a settled payout should reach the fleet.
    const parsed = this.parseEither(payload, verifiedBy);

    if (!parsed) {
      // An event type we do not act on. Acknowledged, never 4xx'd — Razorpay
      // retries on any non-2xx and eventually disables an endpoint that keeps
      // rejecting, so a 400 here would take down settlement for everything.
      this.logger.debug('ignoring unrecognised webhook event');
      return { received: true };
    }

    const { kind, event } = parsed;

    // 4. Dedup. Zero rows means we have seen this event id, so return 200
    //    immediately — a duplicate must be cheap, never a 409.
    //
    //    `provider` is the port whose parser MATCHED, not whichever verified:
    //    the unique index is `(provider, event_id)`, and recording a payout
    //    event under the payment provider's name would let the same event be
    //    processed twice if the secrets were later separated.
    const providerName = kind === 'payment' ? this.gateway.name : this.provider.name;

    const inserted = (await this.db.execute(sql`
      insert into webhook_events (provider, event_id, event_type, payload)
      values (${providerName}, ${event.eventId}, ${event.eventType}, ${JSON.stringify(payload)}::jsonb)
      on conflict (provider, event_id) do nothing
      returning id
    `)) as unknown as Array<{ id: string }>;

    if (inserted.length === 0) {
      this.logger.debug(`webhook ${event.eventId} already processed`);
      return { received: true };
    }

    const webhookRowId = inserted[0]!.id;

    try {
      if (kind === 'payment') {
        await this.applyPayment(event as PaymentWebhookEvent);
      } else {
        await this.apply(event as PayoutWebhookEvent);
      }
      await this.db.execute(sql`
        update webhook_events set processed_at = now() where id = ${webhookRowId}::uuid
      `);
    } catch (error) {
      // Recorded, still acknowledged: the reconciliation poll re-derives the
      // truth from the provider within five minutes, which is a better outcome
      // than Razorpay retrying a payload we cannot act on.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`webhook ${event.eventId} could not be applied: ${reason}`);
      await this.db.execute(sql`
        update webhook_events set error = ${reason} where id = ${webhookRowId}::uuid
      `);
    }

    return { received: true };
  }

  /**
   * Whichever parser recognises the payload, starting with the port that
   * verified the signature.
   */
  private parseEither(
    payload: unknown,
    verifiedBy: 'payment' | 'payout',
  ): { kind: 'payment'; event: PaymentWebhookEvent } | { kind: 'payout'; event: PayoutWebhookEvent } | null {
    const order: Array<'payment' | 'payout'> =
      verifiedBy === 'payment' ? ['payment', 'payout'] : ['payout', 'payment'];

    for (const kind of order) {
      if (kind === 'payment') {
        const event = this.gateway.parseWebhook(payload);
        if (event) return { kind: 'payment', event };
      } else {
        const event = this.provider.parseWebhook(payload);
        if (event) return { kind: 'payout', event };
      }
    }

    return null;
  }

  /**
   * §14.2's "webhook confirms (signature-verified)" — the authoritative half of
   * the capture, and the one that works when the app dies mid-sheet.
   */
  private async applyPayment(event: PaymentWebhookEvent): Promise<void> {
    if (event.status === 'captured') {
      const bookingId = await this.resolveBookingId(event);
      if (!bookingId) {
        // Typically the race where the gateway captured and answered before our
        // own intent row committed. Throwing records it on
        // `webhook_events.error` and still 200s; the five-minute sweep
        // re-derives the truth. Exactly the shape the payout branch uses.
        throw new Error(
          `no booking matches payment ref=${event.gatewayRef ?? 'null'} order=${event.orderRef ?? 'null'}`,
        );
      }

      await this.payments.settleCapturedPayment(bookingId, {
        gatewayRef: event.gatewayRef,
        orderRef: event.orderRef,
        status: 'captured',
        method: (event.method as 'upi' | 'card' | 'wallet' | null) ?? null,
        amountPaise: event.amountPaise,
      });
      return;
    }

    if (event.status === 'failed') {
      const paymentId = await this.resolvePaymentId(event);
      // §19.2: the BOOKING stays `completed`. A failed payment is an unpaid
      // trip, not a cancelled one.
      if (paymentId) {
        await this.payments.markFailed(
          paymentId,
          event.failureReason ?? 'The gateway reported this payment as failed',
        );
      }
      return;
    }

    if (event.status === 'refunded') {
      if (event.gatewayRef) await this.refunds.markProcessedByGatewayRef(event.gatewayRef);
      return;
    }

    // `authorized` / `unknown`: nothing to transition. The sweep follows up.
  }

  /** Notes first, then either gateway reference — three chances, cheapest first. */
  private async resolveBookingId(event: PaymentWebhookEvent): Promise<string | null> {
    if (event.bookingId) return event.bookingId;
    const paymentId = await this.resolvePaymentId(event);
    if (!paymentId) return null;
    const row = await this.payments.paymentById(paymentId);
    return row?.bookingId ?? null;
  }

  private async resolvePaymentId(event: PaymentWebhookEvent): Promise<string | null> {
    if (event.paymentId) return event.paymentId;
    const row = await this.payments.findForWebhook(event.gatewayRef, event.orderRef);
    return row?.id ?? null;
  }

  private async apply(event: PayoutWebhookEvent): Promise<void> {
    const payout = await this.payouts.findForWebhook(event.providerRef, event.payoutId);

    if (!payout) {
      // Typically the race where the provider accepted the payout and answered
      // the webhook before our own `markProcessing` committed.
      throw new Error(
        `no payout matches ref=${event.providerRef ?? 'null'} id=${event.payoutId ?? 'null'}`,
      );
    }

    if (event.status === 'paid') {
      await this.payouts.markPaid(payout.id, event.providerRef);
      return;
    }

    if (event.status === 'failed') {
      await this.payouts.markFailed(payout.id, event.failureReason ?? 'Provider reported a failure');
      return;
    }

    // `processing` / `unknown`: nothing to transition. The row is already
    // non-terminal and the poll will follow up.
  }
}
