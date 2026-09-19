import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  adminFinanceConfigUpdateSchema,
  adminLedgerQuerySchema,
  adminPayoutRejectSchema,
  adminPayoutSlaQuerySchema,
  adminPayoutsQuerySchema,
  adminReconciliationQuerySchema,
  adminRefundIssueSchema,
  adminRefundsQuerySchema,
  adminTransactionsQuerySchema,
  type AdminFinanceConfigUpdate,
  type AdminLedgerQuery,
  type AdminPayoutRejectRequest,
  type AdminPayoutSlaQuery,
  type AdminPayoutsQuery,
  type AdminReconciliationQuery,
  type AdminRefundIssue,
  type AdminRefundsQuery,
  type AdminTransactionsQuery,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms, Roles } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AdminFinanceService } from './admin-finance.service';

/**
 * §9.4.10's Finance approval queue — the second admin surface, after Phase 11's
 * KYC queue.
 *
 * ⚠ `@Realms('admin')` IS NOT OPTIONAL. A controller with no `@Realms()` FAILS
 * CLOSED to fleet-only, which is the default eleven pre-Phase-10 controllers
 * rely on — so omitting it here would 403 every admin rather than leaking to
 * fleets, but it would still be broken.
 *
 * `@Roles('super_admin', 'finance')` throughout, including the READ. Unlike the
 * KYC queue — where `support` can look but not decide — a payout queue exposes
 * every owner's bank details and amounts, and §9.4.10's AC says outright that
 * "payouts require Finance/Super Admin".
 */
@Controller('admin/finance')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminFinanceController {
  constructor(private readonly finance: AdminFinanceService) {}

  @Get('payouts')
  @Roles('super_admin', 'finance')
  payouts(@ZodQuery(adminPayoutsQuerySchema) query: AdminPayoutsQuery) {
    return this.finance.payoutQueue(query);
  }

  @Post('payouts/:id/approve')
  @Roles('super_admin', 'finance')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  approve(@ZodParam(z.uuid(), 'id') payoutId: string, @Req() request: AuthedRequest) {
    return this.finance.approve(adminId(request), payoutId, sessionContextFrom(request));
  }

  /**
   * Rejection requires a reason; approval does not.
   *
   * The same asymmetry `adminDocumentReviewSchema` uses for KYC, for the same
   * reason: approval is the expected outcome, while a rejection is something
   * somebody will have to explain later — to the driver whose money it is, and
   * to whoever reads `admin_actions`.
   */
  @Post('payouts/:id/reject')
  @Roles('super_admin', 'finance')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  reject(
    @ZodParam(z.uuid(), 'id') payoutId: string,
    @ZodBody(adminPayoutRejectSchema) body: AdminPayoutRejectRequest,
    @Req() request: AuthedRequest,
  ) {
    return this.finance.reject(adminId(request), payoutId, body.reason, sessionContextFrom(request));
  }

  @Get('config')
  @Roles('super_admin', 'finance')
  config() {
    return this.finance.config();
  }

  // ── W9: the console reads and the refund write ───────────────────────────

  /**
   * §14.4's decision latency. A GET inside the `payouts` prefix, so it must be
   * declared before any future `payouts/:id` GET route — the same ordering
   * discipline `bookings/export.csv` documents.
   */
  @Get('payouts/sla')
  @Roles('super_admin', 'finance')
  payoutSla(@ZodQuery(adminPayoutSlaQuerySchema) query: AdminPayoutSlaQuery) {
    return this.finance.payoutSla(query);
  }

  @Get('transactions')
  @Roles('super_admin', 'finance')
  transactions(@ZodQuery(adminTransactionsQuerySchema) query: AdminTransactionsQuery) {
    return this.finance.transactions(query);
  }

  @Get('ledger')
  @Roles('super_admin', 'finance')
  ledger(@ZodQuery(adminLedgerQuerySchema) query: AdminLedgerQuery) {
    return this.finance.ledger(query);
  }

  @Get('refunds')
  @Roles('super_admin', 'finance')
  refunds(@ZodQuery(adminRefundsQuerySchema) query: AdminRefundsQuery) {
    return this.finance.refunds(query);
  }

  /**
   * THE ONE FINANCE WRITE, and the only route in the console that REQUIRES
   * `Idempotency-Key` — the `@IdempotencyKey()` decorator 400s without it, and
   * the global `IdempotencyInterceptor` answers a repeated key with the first
   * response verbatim (`Idempotency-Replayed: true`) rather than a second
   * refund. The service still hashes the key with the issuing admin's id for
   * the REFUND ROW's own key, so two operators sending `1` never collide in
   * the ledger.
   */
  @Post('refunds')
  @Roles('super_admin', 'finance')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  issueRefund(
    @ZodBody(adminRefundIssueSchema) body: AdminRefundIssue,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: AuthedRequest,
  ) {
    return this.finance.issueRefund(adminId(request), body, idempotencyKey, sessionContextFrom(request));
  }

  /**
   * One IST day of money as a file. `@Res()` because the body is a byte
   * stream — `streamCsv` writes the escaping (formula injection included).
   * The date defaults to TODAY in IST: an operator running the morning
   * reconciliation means yesterday, but they say so; a bare URL means the day
   * in progress, and guessing otherwise would hide the day's own activity.
   */
  @Get('reconciliation.csv')
  @Roles('super_admin', 'finance')
  reconciliationCsv(
    @ZodQuery(adminReconciliationQuerySchema) query: AdminReconciliationQuery,
    @Res() res: Response,
  ) {
    const date =
      query.date ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return this.finance.reconciliationCsv(res, date);
  }

  /**
   * §14.1's five invariants, live. The panel answers "is the ledger sound
   * right now?" with the SAME query the nightly job and the suite assert.
   */
  @Get('invariants')
  @Roles('super_admin', 'finance')
  invariants() {
    return this.finance.invariants();
  }

  @Put('config')
  @Roles('super_admin', 'finance')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  updateConfig(
    @ZodBody(adminFinanceConfigUpdateSchema) body: AdminFinanceConfigUpdate,
    @Req() request: AuthedRequest,
  ) {
    return this.finance.updateConfig(adminId(request), body, sessionContextFrom(request));
  }
}

function adminId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
