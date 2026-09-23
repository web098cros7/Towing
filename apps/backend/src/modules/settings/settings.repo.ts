import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FleetId, NotificationPrefs, OnboardingStep } from '@towing/api-contracts';
import { DB, type Database } from '../../db/db.module';

export interface FleetSettingsRow {
  businessName: string;
  gstin: string | null;
  address: string | null;
  notificationPrefs: Partial<NotificationPrefs>;
  onboardingStep: OnboardingStep;
  profileCompletedAt: Date | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  /** 0042: how this fleet pays its drivers. */
  driverPay: { model: 'share' | 'salary'; driverSharePct: number };
}

export interface PayoutAccountRow {
  status: 'unlinked' | 'pending' | 'active' | 'rejected' | 'suspended';
  beneficiaryName: string | null;
  accountNumberLast4: string | null;
  ifsc: string | null;
  bankName: string | null;
  failureReason: string | null;
  linkedAt: Date | null;
  routeFundAccountId: string | null;
}

/** Takes `DB`, not `DB_READER` — this repo writes. */
@Injectable()
export class SettingsRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  async fleet(fleetId: FleetId): Promise<FleetSettingsRow | null> {
    const rows = (await this.db.execute(sql`
      select f.business_name, f.gstin, f.address, f.notification_prefs,
             f.onboarding_step, f.profile_completed_at,
             f.driver_pay_model, f.driver_share_pct::text as driver_share_pct,
             u.email as owner_email, u.mobile as owner_mobile
        from fleets f
        join users u on u.id = f.owner_id
       where f.id = ${fleetId}::uuid
    `)) as unknown as Array<{
      business_name: string;
      gstin: string | null;
      address: string | null;
      notification_prefs: Partial<NotificationPrefs>;
      onboarding_step: OnboardingStep;
      // A raw `db.execute` bypasses Drizzle's column mappers, so postgres.js
      // hands timestamps back as strings. Coerced here so nothing downstream
      // has to know which query style produced the row.
      profile_completed_at: string | null;
      driver_pay_model: 'share' | 'salary';
      driver_share_pct: string;
      owner_email: string | null;
      owner_mobile: string | null;
    }>;

    const row = rows[0];
    if (!row) return null;

    return {
      businessName: row.business_name,
      gstin: row.gstin,
      address: row.address,
      notificationPrefs: row.notification_prefs ?? {},
      onboardingStep: row.onboarding_step,
      profileCompletedAt: row.profile_completed_at ? new Date(row.profile_completed_at) : null,
      ownerEmail: row.owner_email,
      ownerPhone: row.owner_mobile,
      driverPay: { model: row.driver_pay_model, driverSharePct: Number(row.driver_share_pct) },
    };
  }

  /** 0042: how this fleet pays its drivers. Applies to jobs accepted from now on. */
  async updateDriverPay(
    fleetId: FleetId,
    pay: { model: 'share' | 'salary'; driverSharePct: number },
  ): Promise<void> {
    await this.db.execute(sql`
      update fleets
         set driver_pay_model = ${pay.model},
             driver_share_pct = ${pay.driverSharePct.toFixed(2)}::numeric,
             updated_at = now()
       where id = ${fleetId}::uuid
    `);
  }

  async payoutAccount(fleetId: FleetId): Promise<PayoutAccountRow | null> {
    const rows = (await this.db.execute(sql`
      select status, beneficiary_name, account_number_last4, ifsc, bank_name,
             failure_reason, linked_at, route_fund_account_id
        from payout_accounts
       where owner_type = 'fleet' and owner_id = ${fleetId}::uuid
    `)) as unknown as Array<{
      status: PayoutAccountRow['status'];
      beneficiary_name: string | null;
      account_number_last4: string | null;
      ifsc: string | null;
      bank_name: string | null;
      failure_reason: string | null;
      /** String, not Date — see the note in `fleet()`. */
      linked_at: string | null;
      route_fund_account_id: string | null;
    }>;

    const row = rows[0];
    if (!row) return null;

    return {
      status: row.status,
      beneficiaryName: row.beneficiary_name,
      accountNumberLast4: row.account_number_last4,
      ifsc: row.ifsc,
      bankName: row.bank_name,
      failureReason: row.failure_reason,
      linkedAt: row.linked_at ? new Date(row.linked_at) : null,
      routeFundAccountId: row.route_fund_account_id,
    };
  }

  /**
   * Applies the profile patch and recomputes `profile_completed_at`.
   *
   * Read-merge-write inside ONE transaction, with the merge done in TypeScript.
   * The all-in-SQL version needed a `CASE` over five conditionally-interpolated
   * fragments and Postgres could not infer a type for a bare parameter in
   * `$n IS NOT NULL` — the readable version is also the one that works. The
   * `FOR UPDATE` closes the read-modify-write window, so `profile_completed_at`
   * can never disagree with the columns it summarises (which
   * `ck_fleets_profile_completed_requires_address` would then reject).
   *
   * Once set the timestamp is never cleared: an account that became usable
   * stays usable, and "when did it become usable" stays an honest audit answer.
   */
  async updateProfile(
    fleetId: FleetId,
    patch: {
      businessName?: string;
      gstin?: string | null;
      address?: string | null;
      notificationPrefs?: Partial<NotificationPrefs>;
    },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select business_name, gstin, address, notification_prefs, profile_completed_at
          from fleets where id = ${fleetId}::uuid for update
      `)) as unknown as Array<{
        business_name: string;
        gstin: string | null;
        address: string | null;
        notification_prefs: Partial<NotificationPrefs>;
        profile_completed_at: string | null;
      }>;

      const current = rows[0];
      if (!current) return;

      const businessName = patch.businessName ?? current.business_name;
      const gstin = patch.gstin === undefined ? current.gstin : patch.gstin;
      const address = patch.address === undefined ? current.address : patch.address;
      // Merge, never replace: a client that knows about three preferences must
      // not blank a fourth it has never heard of.
      const prefs = { ...(current.notification_prefs ?? {}), ...(patch.notificationPrefs ?? {}) };

      const complete = businessName.trim().length > 0 && (address ?? '').trim().length > 0;
      const completedAt = current.profile_completed_at ?? (complete ? new Date().toISOString() : null);

      await tx.execute(sql`
        update fleets
           set business_name = ${businessName},
               gstin = ${gstin}::text,
               address = ${address}::text,
               notification_prefs = ${JSON.stringify(prefs)}::jsonb,
               profile_completed_at = ${completedAt}::timestamptz,
               updated_at = now()
         where id = ${fleetId}::uuid
      `);
    });
  }

  /**
   * Advances the wizard by exactly one step, and never backwards.
   *
   * `where onboarding_step = $from` makes a double-tapped "Next" a no-op rather
   * than a skip, and the step can only ever be written by this method — a
   * client that could set it in a profile PUT could walk itself past the gate.
   */
  async advanceOnboarding(fleetId: FleetId, from: OnboardingStep, to: OnboardingStep): Promise<boolean> {
    const rows = (await this.db.execute(sql`
      update fleets
         set onboarding_step = ${to}::fleet_onboarding_step, updated_at = now()
       where id = ${fleetId}::uuid
         and onboarding_step = ${from}::fleet_onboarding_step
      returning id
    `)) as unknown as Array<{ id: string }>;

    return rows.length > 0;
  }

  async upsertPayoutAccount(
    fleetId: FleetId,
    values: {
      status: PayoutAccountRow['status'];
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
        ${fleetId}::uuid, 'fleet', ${values.status}::payout_account_status,
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

  async unlinkPayoutAccount(fleetId: FleetId): Promise<void> {
    // Keeps the row (and its fingerprint) so "did they change the account?"
    // stays answerable, but clears the destination so no payout can reach it.
    await this.db.execute(sql`
      update payout_accounts
         set status = 'unlinked', route_fund_account_id = null,
             linked_at = null, updated_at = now()
       where owner_type = 'fleet' and owner_id = ${fleetId}::uuid
    `);
  }

  async hasOpenPayout(fleetId: FleetId): Promise<boolean> {
    const [row] = (await this.db.execute(sql`
      select exists(
        select 1 from payouts
         where owner_type = 'fleet' and owner_id = ${fleetId}::uuid
           and status in ('requested', 'processing')
      ) as open
    `)) as unknown as [{ open: boolean }];

    return row.open;
  }
}
