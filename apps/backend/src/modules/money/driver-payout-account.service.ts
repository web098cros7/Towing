import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ErrorCodes,
  type PayoutAccountDto,
  type PayoutAccountLinkRequest,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { PAYOUT_PROVIDER, type PayoutProviderPort } from './payout-provider.port';
import { PayoutAccountsRepo } from './payout-accounts.repo';

/**
 * Driver-side Route linked-account onboarding — the fleet-side equivalent
 * shipped in Track A Phase 7 and this is its twin, deliberately structured the
 * same way.
 *
 * ZERO ADAPTER CHANGE WAS NEEDED. `PayoutProviderPort.linkAccount` has taken
 * `ownerType` on every call since Phase 7, and `RazorpayRouteAdapter` already
 * branches Razorpay's contact `type` on it — `vendor` for a fleet, `employee`
 * for a driver. The port's docstring anticipated exactly this: "Track B Phase
 * 19 pays drivers through this same port."
 *
 * THE FULL ACCOUNT NUMBER IS NEVER PERSISTED — it goes to the provider and what
 * stays behind is the last four digits and a fingerprint.
 */
@Injectable()
export class DriverPayoutAccountService {
  private readonly logger = new Logger(DriverPayoutAccountService.name);

  constructor(
    private readonly accounts: PayoutAccountsRepo,
    @Inject(DB) private readonly db: Database,
    @Inject(PAYOUT_PROVIDER) private readonly payouts: PayoutProviderPort,
  ) {}

  async get(driverId: string): Promise<PayoutAccountDto> {
    const row = await this.accounts.byOwner({ ownerType: 'driver', ownerId: driverId });

    // An unlinked account is a state, not a 404: the app renders an onboarding
    // card for it.
    if (!row) {
      return {
        status: 'unlinked',
        beneficiaryName: null,
        accountNumberLast4: null,
        ifsc: null,
        bankName: null,
        failureReason: null,
        linkedAt: null,
      };
    }

    return {
      status: row.status,
      beneficiaryName: row.beneficiaryName,
      accountNumberLast4: row.accountNumberLast4,
      ifsc: row.ifsc,
      bankName: row.bankName,
      failureReason: row.failureReason,
      linkedAt: row.linkedAt?.toISOString() ?? null,
    };
  }

  async link(driverId: string, input: PayoutAccountLinkRequest): Promise<PayoutAccountDto> {
    const [driver] = (await this.db.execute(sql`
      select d.name, u.mobile, u.email
        from drivers d join users u on u.id = d.user_id
       where d.id = ${driverId}::uuid
    `)) as unknown as Array<{ name: string; mobile: string | null; email: string | null } | undefined>;

    if (!driver) throw ApiException.notFound('Driver not found');

    let linked;
    try {
      linked = await this.payouts.linkAccount({
        ownerType: 'driver',
        ownerId: driverId,
        legalName: driver.name,
        beneficiaryName: input.beneficiaryName,
        accountNumber: input.accountNumber,
        ifsc: input.ifsc,
        email: driver.email ?? '',
        phone: driver.mobile ?? '',
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // NEVER echo the reason to the caller — a provider error can carry the
      // request body back, and the request body contains an account number.
      this.logger.error(`payout account link failed for driver ${driverId}: ${reason}`);
      throw new ApiException(
        HttpStatus.BAD_GATEWAY,
        ErrorCodes.INTERNAL,
        'Could not reach the payout provider. Your bank details were not saved — please try again.',
      );
    }

    await this.accounts.upsert(
      { ownerType: 'driver', ownerId: driverId },
      {
        status: linked.status === 'rejected' ? 'rejected' : linked.status,
        routeAccountId: linked.accountId,
        routeFundAccountId: linked.fundAccountId,
        beneficiaryName: input.beneficiaryName,
        accountNumberLast4: input.accountNumber.slice(-4),
        accountNumberFingerprint: fingerprint(input.accountNumber, input.ifsc),
        ifsc: input.ifsc,
        bankName: linked.bankName ?? null,
        failureReason: linked.failureReason ?? null,
      },
    );

    return this.get(driverId);
  }

  async unlink(driverId: string): Promise<void> {
    if (await this.accounts.hasOpenPayout({ ownerType: 'driver', ownerId: driverId })) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.CONFLICT,
        'A payout is still in flight. Wait for it to settle before changing bank details.',
      );
    }

    await this.accounts.unlink({ ownerType: 'driver', ownerId: driverId });
  }
}

/**
 * `sha256(number|ifsc)` — enough to answer "did they change the account?"
 * without being able to answer "what is it?".
 */
function fingerprint(accountNumber: string, ifsc: string): string {
  return createHash('sha256').update(`${accountNumber}|${ifsc}`).digest('hex');
}
