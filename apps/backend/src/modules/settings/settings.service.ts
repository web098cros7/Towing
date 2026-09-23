import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCodes,
  NOTIFICATION_PREF_DEFAULTS,
  type FleetId,
  type FleetSettingsDto,
  type FleetDriverPayUpdate,
  type FleetSettingsUpdate,
  type OnboardingStep,
  type PayoutAccountLinkRequest,
} from '@towing/api-contracts';
import { CacheService } from '../../common/cache/cache.service';
import { ApiException } from '../../common/errors/api-exception';
import { ProfileCompleteGuard } from '../../common/tenancy/profile-complete.guard';
import { PAYOUT_PROVIDER, type PayoutProviderPort } from '../money/payout-provider.port';
import { SettingsRepo, type PayoutAccountRow } from './settings.repo';

/** The §9.3.1 wizard, in order. `advance` may only ever move one step right. */
const STEP_ORDER: OnboardingStep[] = ['profile', 'payout_account', 'notifications', 'done'];

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly repo: SettingsRepo,
    private readonly cache: CacheService,
    @Inject(PAYOUT_PROVIDER) private readonly payouts: PayoutProviderPort,
  ) {}

  async get(fleetId: FleetId): Promise<FleetSettingsDto> {
    const fleet = await this.repo.fleet(fleetId);
    if (!fleet) throw ApiException.notFound('Fleet not found');

    const account = await this.repo.payoutAccount(fleetId);

    return {
      businessName: fleet.businessName,
      gstin: fleet.gstin,
      address: fleet.address,
      // Defaults filled in on READ, so adding a preference later never blanks
      // it for a fleet whose stored object predates it.
      notificationPrefs: { ...NOTIFICATION_PREF_DEFAULTS, ...fleet.notificationPrefs },
      payoutAccount: toAccountDto(account),
      driverPay: fleet.driverPay,
      onboarding: {
        step: fleet.onboardingStep,
        profileComplete: fleet.profileCompletedAt !== null,
        payoutAccountLinked: account?.status === 'active',
        completedAt: fleet.profileCompletedAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * 0042: how the owner pays their drivers — a share of each job, or a salary
   * with the fleet keeping the payout. Applies to jobs accepted AFTER the
   * change: each job locks its split when the driver accepts it, so nobody is
   * paid differently for a job they already took.
   */
  async updateDriverPay(fleetId: FleetId, pay: FleetDriverPayUpdate): Promise<FleetSettingsDto> {
    await this.repo.updateDriverPay(fleetId, pay);
    return this.get(fleetId);
  }

  async update(fleetId: FleetId, patch: FleetSettingsUpdate): Promise<FleetSettingsDto> {
    await this.repo.updateProfile(fleetId, patch);
    // The gate reads a 60 s cached copy; without this bust, completing the
    // profile would leave payouts 403-ing for up to a minute afterwards.
    await this.cache.invalidate(ProfileCompleteGuard.cacheKey(fleetId));

    return this.get(fleetId);
  }

  /**
   * §9.3.1's "bank details for payouts (Route)".
   *
   * The vendor call happens OUTSIDE any transaction — holding a row lock across
   * a network call to a third party is how a slow provider becomes a database
   * incident.
   *
   * **The full account number is never persisted.** It goes to the provider and
   * is dropped; we keep the last four for display and a sha256 of
   * `number|ifsc` so "did they change the account?" stays answerable without
   * being reversible.
   */
  async linkPayoutAccount(
    fleetId: FleetId,
    input: PayoutAccountLinkRequest,
  ): Promise<FleetSettingsDto> {
    const fleet = await this.repo.fleet(fleetId);
    if (!fleet) throw ApiException.notFound('Fleet not found');

    let linked;
    try {
      linked = await this.payouts.linkAccount({
        ownerType: 'fleet',
        ownerId: fleetId,
        legalName: fleet.businessName,
        beneficiaryName: input.beneficiaryName,
        accountNumber: input.accountNumber,
        ifsc: input.ifsc,
        email: fleet.ownerEmail ?? '',
        phone: fleet.ownerPhone ?? '',
        gstin: fleet.gstin,
        address: fleet.address,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`payout account link failed for fleet ${fleetId}: ${reason}`);
      throw new ApiException(
        HttpStatus.BAD_GATEWAY,
        ErrorCodes.INTERNAL,
        'Could not reach the payout provider. Your bank details were not saved — please try again.',
      );
    }

    await this.repo.upsertPayoutAccount(fleetId, {
      status: linked.status === 'rejected' ? 'rejected' : linked.status,
      routeAccountId: linked.accountId,
      routeFundAccountId: linked.fundAccountId,
      beneficiaryName: input.beneficiaryName,
      accountNumberLast4: input.accountNumber.slice(-4),
      accountNumberFingerprint: fingerprint(input.accountNumber, input.ifsc),
      ifsc: input.ifsc,
      bankName: linked.bankName ?? null,
      failureReason: linked.failureReason ?? null,
    });

    // Linking IS completing the payout step, so advance without a second call.
    if (fleet.onboardingStep === 'payout_account' && linked.status === 'active') {
      await this.repo.advanceOnboarding(fleetId, 'payout_account', 'notifications');
    }

    return this.get(fleetId);
  }

  async unlinkPayoutAccount(fleetId: FleetId): Promise<FleetSettingsDto> {
    if (await this.repo.hasOpenPayout(fleetId)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.CONFLICT,
        'A payout is still in flight. Wait for it to settle before changing bank details.',
      );
    }

    await this.repo.unlinkPayoutAccount(fleetId);
    return this.get(fleetId);
  }

  /**
   * The only way `onboarding_step` ever moves. One step at a time, forwards
   * only, and never past `profile` until the profile is genuinely complete —
   * which is what stops a client walking itself around the §9.3.1 gate by
   * declaring itself done.
   */
  async advanceOnboarding(fleetId: FleetId, from: OnboardingStep): Promise<FleetSettingsDto> {
    const fleet = await this.repo.fleet(fleetId);
    if (!fleet) throw ApiException.notFound('Fleet not found');

    if (from === 'profile' && fleet.profileCompletedAt === null) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCodes.PROFILE_INCOMPLETE,
        'Complete your business profile before continuing',
        { onboardingStep: fleet.onboardingStep, missing: missingProfileFields(fleet) },
      );
    }

    const next = STEP_ORDER[STEP_ORDER.indexOf(from) + 1];
    if (!next) {
      // Already at `done`; a repeated tap is a no-op, not an error.
      return this.get(fleetId);
    }

    await this.repo.advanceOnboarding(fleetId, from, next);
    return this.get(fleetId);
  }
}

function toAccountDto(account: PayoutAccountRow | null): FleetSettingsDto['payoutAccount'] {
  if (!account) {
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
    status: account.status,
    beneficiaryName: account.beneficiaryName,
    accountNumberLast4: account.accountNumberLast4,
    ifsc: account.ifsc,
    bankName: account.bankName,
    failureReason: account.failureReason,
    linkedAt: account.linkedAt?.toISOString() ?? null,
  };
}

function missingProfileFields(fleet: { businessName: string; address: string | null }): string[] {
  const missing: string[] = [];
  if (!fleet.businessName.trim()) missing.push('businessName');
  // §9.3.1 makes GSTIN explicitly optional.
  if (!fleet.address?.trim()) missing.push('address');
  return missing;
}

function fingerprint(accountNumber: string, ifsc: string): string {
  return createHash('sha256').update(`${accountNumber}|${ifsc}`).digest('hex');
}
