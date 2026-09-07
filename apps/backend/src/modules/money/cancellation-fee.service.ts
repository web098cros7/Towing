import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCodes, paiseToRupeeString } from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { paymentRowKey } from '../../db/ledger/idempotency-keys';
import { PAYMENT_GATEWAY, type PaymentGatewayPort } from './payment-gateway.port';
import { PaymentsRepo } from './payments.repo';

/**
 * §3.5's cancellation fee — collected, and nothing else.
 *
 * DELIBERATELY NOT A SETTLEMENT. A fare capture credits a driver, moves a
 * booking to `paid` and writes ledger legs; this only records that a fee was
 * taken. The driver's share of it is posted by `BookingsService` as an
 * `adjustment` after the cancel commits, because that is the leg type §3.5's
 * compensation must use — an earning type on a cancelled booking would make
 * the earnings projector count the full fare of a trip that never ran.
 *
 * Living here rather than in `PaymentsService` is what lets `BookingsModule`
 * import the gateway without importing settlement, and therefore without a
 * module cycle. See `PaymentGatewayModule`.
 */
@Injectable()
export class CancellationFeeService {
  private readonly logger = new Logger(CancellationFeeService.name);

  constructor(
    private readonly repo: PaymentsRepo,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
  ) {}

  /**
   * Verifies the checkout result and marks the fee captured.
   *
   * Same discipline as the fare path: the signature is checked first and writes
   * nothing, then the GATEWAY is asked what actually happened, and only then is
   * anything recorded. A caller that says "captured" may be replaying,
   * confused, or lying.
   */
  async capture(
    bookingId: string,
    params: { gatewayRef: string; orderRef: string; signature: string },
    expectedPaise: number,
  ): Promise<void> {
    // Already collected — a replay, not an error. The customer's app retries.
    const existing = await this.repo.capturedFor(bookingId, 'cancellation_fee');
    if (existing) return;

    if (!this.gateway.verifyCheckout(params)) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.INVALID_PAYMENT_SIGNATURE,
        'This payment could not be verified',
      );
    }

    const handle = await this.gateway.fetchPayment({
      gatewayRef: params.gatewayRef,
      orderRef: params.orderRef,
    });

    if (handle.status !== 'captured') {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCodes.PAYMENT_NOT_CAPTURED,
        'We are still confirming this payment with your bank',
        { gatewayStatus: handle.status },
      );
    }

    // The same attack the fare path guards: a ₹1 order presented against a
    // ₹1,500 fee. A null amount means the gateway did not say.
    if (handle.amountPaise !== null && handle.amountPaise !== expectedPaise) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.PAYMENT_AMOUNT_MISMATCH,
        'The amount paid does not match this cancellation fee',
      );
    }

    const row =
      (await this.repo.openIntent(bookingId, 'cancellation_fee')) ??
      (await this.createRow(bookingId, expectedPaise, params.gatewayRef));

    await this.repo.markCaptured(row.id, {
      gatewayRef: handle.gatewayRef ?? params.gatewayRef,
      method: handle.method,
    });

    this.logger.log(
      `event=cancellation_fee_captured booking=${bookingId} amount_paise=${expectedPaise}`,
    );
  }

  /** The intent row never existed — the app went straight to the gateway. */
  private async createRow(bookingId: string, amountPaise: number, gatewayRef: string) {
    try {
      return await this.repo.create({
        bookingId,
        amount: paiseToRupeeString(amountPaise),
        taxAmount: '0',
        purpose: 'cancellation_fee',
        method: 'upi',
        // Derived from the GATEWAY reference rather than a client key, because
        // there is no client key here — and it is stable, so a retry dedupes.
        idempotencyKey: paymentRowKey(
          bookingId,
          'cancellation_fee',
          createHash('sha256').update(gatewayRef).digest('hex'),
        ),
        provider: this.gateway.name,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.repo.byGatewayRef(gatewayRef);
      if (!raced) throw error;
      return raced;
    }
  }
}
