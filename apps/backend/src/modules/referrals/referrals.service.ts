import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { ErrorCodes } from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { DB, type Database } from '../../db/db.module';
import { LedgerService } from '../../db/ledger/ledger.service';
import type { LedgerLeg } from '../../db/ledger/ledger.types';

const SHARE_BASE_URL = 'https://mitow.in/r/';
const SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_REWARD_PAISE = 10000;

/**
 * Refer & Earn (Figma 45). Mints a per-user code, records redemptions, credits
 * the referee's wallet when they apply the code (so it can be spent on their
 * first trip), and credits the referrer once that first trip is paid.
 */
@Injectable()
export class ReferralsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ledger: LedgerService,
  ) {}

  private async rewards(): Promise<{ referrerRewardPaise: number; refereeRewardPaise: number }> {
    const rows = (await this.db.execute(sql`
      select referrer_reward_paise, referee_reward_paise from app_config limit 1
    `)) as unknown as Array<{ referrer_reward_paise: number | null; referee_reward_paise: number | null }>;

    if (rows.length === 0) {
      return { referrerRewardPaise: DEFAULT_REWARD_PAISE, refereeRewardPaise: DEFAULT_REWARD_PAISE };
    }
    return {
      referrerRewardPaise: rows[0]!.referrer_reward_paise ?? DEFAULT_REWARD_PAISE,
      refereeRewardPaise: rows[0]!.referee_reward_paise ?? DEFAULT_REWARD_PAISE,
    };
  }

  private async ensureCode(userId: string): Promise<string> {
    const existing = (await this.db.execute(sql`
      select code from referral_codes where user_id = ${userId}::uuid
    `)) as unknown as Array<{ code: string }>;
    if (existing.length > 0) return existing[0]!.code;

    const nameRows = (await this.db.execute(sql`
      select name from users where id = ${userId}::uuid
    `)) as unknown as Array<{ name: string | null }>;
    const rawName = nameRows[0]?.name ?? '';
    const letters = rawName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    const prefix = letters.length > 0 ? letters : 'MITOW';

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const suffix = Array.from({ length: 4 }, () => SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)]).join('');
      const code = `${prefix}${suffix}`;
      try {
        await this.db.execute(sql`
          insert into referral_codes (user_id, code) values (${userId}::uuid, ${code})
        `);
        return code;
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }
    throw new ApiException(HttpStatus.CONFLICT, ErrorCodes.VALIDATION_FAILED, 'Could not allocate a referral code');
  }

  async summary(userId: string) {
    const code = await this.ensureCode(userId);
    const { referrerRewardPaise, refereeRewardPaise } = await this.rewards();

    const counts = (await this.db.execute(sql`
      select
        count(*)::int as invited,
        count(*) filter (where status = 'rewarded')::int as rewarded,
        coalesce(sum(referrer_reward_paise) filter (where status = 'rewarded'), 0)::int as earned
      from referral_redemptions
      where referrer_user_id = ${userId}::uuid
    `)) as unknown as Array<{ invited: number; rewarded: number; earned: number }>;

    const applied = (await this.db.execute(sql`
      select code from referral_redemptions where referee_user_id = ${userId}::uuid
    `)) as unknown as Array<{ code: string }>;
    const appliedCode = applied.length > 0 ? applied[0]!.code : null;

    const bookingRows = (await this.db.execute(sql`
      select 1 from bookings where user_id = ${userId}::uuid limit 1
    `)) as unknown as Array<unknown>;
    const hasBookings = bookingRows.length > 0;

    return {
      code,
      shareUrl: SHARE_BASE_URL + code,
      referrerRewardPaise,
      refereeRewardPaise,
      invitedCount: counts[0]?.invited ?? 0,
      rewardedCount: counts[0]?.rewarded ?? 0,
      earnedPaise: counts[0]?.earned ?? 0,
      appliedCode,
      canApplyCode: appliedCode === null && !hasBookings,
    };
  }

  async apply(userId: string, rawCode: string) {
    const code = rawCode.trim().toUpperCase();

    const ownerRows = (await this.db.execute(sql`
      select user_id from referral_codes where upper(code) = ${code}
    `)) as unknown as Array<{ user_id: string }>;
    if (ownerRows.length === 0) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCodes.VALIDATION_FAILED, 'This referral code is not valid');
    }
    const owner = ownerRows[0]!.user_id;
    if (owner === userId) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCodes.VALIDATION_FAILED, 'You cannot use your own referral code');
    }

    const existing = (await this.db.execute(sql`
      select 1 from referral_redemptions where referee_user_id = ${userId}::uuid
    `)) as unknown as Array<unknown>;
    if (existing.length > 0) {
      throw new ApiException(HttpStatus.CONFLICT, ErrorCodes.VALIDATION_FAILED, 'You have already used a referral code');
    }

    const bookingRows = (await this.db.execute(sql`
      select 1 from bookings where user_id = ${userId}::uuid limit 1
    `)) as unknown as Array<unknown>;
    if (bookingRows.length > 0) {
      throw new ApiException(HttpStatus.CONFLICT, ErrorCodes.VALIDATION_FAILED, 'Referral codes are for customers who have not booked yet');
    }

    let redemptionId: string;
    try {
      const inserted = (await this.db.execute(sql`
        insert into referral_redemptions (referrer_user_id, referee_user_id, code)
        values (${owner}::uuid, ${userId}::uuid, ${code})
        returning id
      `)) as unknown as Array<{ id: string }>;
      redemptionId = inserted[0]!.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiException(HttpStatus.CONFLICT, ErrorCodes.VALIDATION_FAILED, 'You have already used a referral code');
      }
      throw error;
    }

    const { refereeRewardPaise } = await this.rewards();

    // The referee's reward is spendable on their first trip, so it is credited
    // now — the wallet is applied automatically at payment.
    if (refereeRewardPaise > 0) {
      await this.ledger.post([
        {
          owner: { ownerType: 'user', ownerId: userId },
          type: 'adjustment',
          amountPaise: refereeRewardPaise,
          reason: 'Welcome reward for joining with a referral code',
          refId: redemptionId,
          idempotencyKey: `rr:v1:${redemptionId}:referee`,
        },
      ]);
      await this.db.execute(sql`
        update referral_redemptions
           set referee_reward_paise = ${refereeRewardPaise}
         where id = ${redemptionId}::uuid
      `);
    }

    return { status: 'pending' as const, refereeRewardPaise };
  }

  /**
   * Called by payment settlement after a booking becomes `paid`. Credits the
   * referrer only when this is the referee's first paid trip; the referee was
   * already credited at apply time.
   */
  async rewardForBooking(bookingId: string): Promise<void> {
    const bookingRows = (await this.db.execute(sql`
      select user_id from bookings where id = ${bookingId}::uuid
    `)) as unknown as Array<{ user_id: string }>;
    if (bookingRows.length === 0) return;
    const refereeUserId = bookingRows[0]!.user_id;

    const redemptionRows = (await this.db.execute(sql`
      select id, referrer_user_id, referee_user_id
      from referral_redemptions
      where referee_user_id = ${refereeUserId}::uuid and status = 'pending'
    `)) as unknown as Array<{ id: string; referrer_user_id: string; referee_user_id: string }>;
    if (redemptionRows.length === 0) return;
    const redemption = redemptionRows[0]!;

    const paidRows = (await this.db.execute(sql`
      select count(*)::int as n from bookings where user_id = ${refereeUserId}::uuid and status = 'paid'
    `)) as unknown as Array<{ n: number }>;
    if ((paidRows[0]?.n ?? 0) !== 1) return;

    const { referrerRewardPaise } = await this.rewards();

    const legs: LedgerLeg[] = [];
    if (referrerRewardPaise > 0) {
      legs.push({
        owner: { ownerType: 'user', ownerId: redemption.referrer_user_id },
        type: 'adjustment',
        amountPaise: referrerRewardPaise,
        reason: 'Referral reward: a friend finished their first trip',
        refId: bookingId,
        idempotencyKey: `rr:v1:${redemption.id}:referrer`,
      });
    }

    if (legs.length > 0) {
      await this.ledger.post(legs);
    }

    await this.db.execute(sql`
      update referral_redemptions
         set status = 'rewarded',
             rewarded_booking_id = ${bookingId}::uuid,
             rewarded_at = now(),
             referrer_reward_paise = ${referrerRewardPaise}
       where id = ${redemption.id}::uuid and status = 'pending'
    `);
  }
}
