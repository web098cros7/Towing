import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PayoutAccountStatus } from '@towing/api-contracts';
import { DB, type Database } from '../../db/db.module';
import type { PayoutOwner } from './payouts.repo';

export interface PayoutAccountRow {
  status: PayoutAccountStatus;
  beneficiaryName: string | null;
  accountNumberLast4: string | null;
  ifsc: string | null;
  bankName: string | null;
  failureReason: string | null;
  linkedAt: Date | null;
  routeFundAccountId: string | null;
}

/**
 * `payout_accounts`, for either owner type.
 *
 * HOISTED IN PHASE 19 rather than copied. `SettingsRepo` has held fleet-only
 * versions of these three since Track A Phase 7, and the driver side needs
 * exactly the same operations against exactly the same table — the schema was
 * built `(owner_type, owner_id)` from the start, and its docstring says so:
 * "Track B Phase 19 needs the identical thing for drivers … a zero-migration
 * change". One table, one repo. `SettingsRepo` now delegates here, which kills
 * the duplication before it exists rather than after it has drifted.
 *
 * THE FULL ACCOUNT NUMBER IS NEVER PERSISTED. It goes to the provider at
 * onboarding and what remains is the last four digits plus a SHA-256
 * fingerprint of `number|ifsc` — enough to answer "did they change the
 * account?" without being able to answer "what is it?".
 */
@Injectable()
export class PayoutAccountsRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  async byOwner(owner: PayoutOwner): Promise<PayoutAccountRow | null> {
    const rows = (await this.db.execute(sql`
      select status, beneficiary_name, account_number_last4, ifsc, bank_name,
             failure_reason, linked_at, route_fund_account_id
        from payout_accounts
       where owner_type = ${owner.ownerType}::wallet_owner_type
         and owner_id = ${owner.ownerId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;

    const row = rows[0];
    if (!row) return null;

    return {
      status: row.status as PayoutAccountStatus,
      beneficiaryName: (row.beneficiary_name as string | null) ?? null,
      accountNumberLast4: (row.account_number_last4 as string | null) ?? null,
      ifsc: (row.ifsc as string | null) ?? null,
      bankName: (row.bank_name as string | null) ?? null,
      failureReason: (row.failure_reason as string | null) ?? null,
      // A string, not a Date — `db.execute` does not coerce.
      linkedAt: row.linked_at ? new Date(row.linked_at as string) : null,
      routeFundAccountId: (row.route_fund_account_id as string | null) ?? null,
    };
  }

  async upsert(
    owner: PayoutOwner,
    values: {
      status: PayoutAccountStatus;
      routeAccountId: string | null;
      routeFundAccountId: string | null;
      beneficiaryName: string;
      accountNumberLast4: string;
      accountNumberFingerprint: string;
      ifsc: string;
      bankName: string | null;
      failureReason: string | null;
    },
  ): Promise<void> {
    await this.db.execute(sql`
      insert into payout_accounts (
        owner_id, owner_type, status, route_account_id, route_fund_account_id,
        beneficiary_name, account_number_last4, account_number_fingerprint,
        ifsc, bank_name, failure_reason, linked_at
      ) values (
        ${owner.ownerId}::uuid, ${owner.ownerType}::wallet_owner_type,
        ${values.status}::payout_account_status,
        ${values.routeAccountId}, ${values.routeFundAccountId},
        ${values.beneficiaryName}, ${values.accountNumberLast4}, ${values.accountNumberFingerprint},
        ${values.ifsc}, ${values.bankName}, ${values.failureReason},
        ${values.status === 'active' ? sql`now()` : sql`null`}
      )
      on conflict (owner_type, owner_id) do update set
        status = excluded.status,
        route_account_id = excluded.route_account_id,
        route_fund_account_id = excluded.route_fund_account_id,
        beneficiary_name = excluded.beneficiary_name,
        account_number_last4 = excluded.account_number_last4,
        account_number_fingerprint = excluded.account_number_fingerprint,
        ifsc = excluded.ifsc,
        bank_name = excluded.bank_name,
        failure_reason = excluded.failure_reason,
        linked_at = excluded.linked_at,
        updated_at = now()
    `);
  }

  async unlink(owner: PayoutOwner): Promise<void> {
    // Keeps the row (and its fingerprint) so "did they change the account?"
    // stays answerable, but clears the destination so no payout can reach it.
    await this.db.execute(sql`
      update payout_accounts
         set status = 'unlinked', route_fund_account_id = null, updated_at = now()
       where owner_type = ${owner.ownerType}::wallet_owner_type
         and owner_id = ${owner.ownerId}::uuid
    `);
  }

  /** Unlinking while money is in flight would strand the payout. */
  async hasOpenPayout(owner: PayoutOwner): Promise<boolean> {
    const [row] = (await this.db.execute(sql`
      select count(*)::int as count from payouts
       where owner_type = ${owner.ownerType}::wallet_owner_type
         and owner_id = ${owner.ownerId}::uuid
         and status in ('requested', 'processing')
    `)) as unknown as [{ count: number }];

    return row.count > 0;
  }
}
