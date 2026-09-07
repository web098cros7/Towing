import { sql, type SQL } from 'drizzle-orm';

/**
 * The per-booking settlement lateral, in ONE place.
 *
 * Both the fleet console's `EarningsRepo.splitFeed` and the driver app's
 * `DriverEarningsRepo.perTripFeed` need the same three numbers from the ledger
 * for the same booking — when it settled, what reached the driver, and what
 * reached the fleet — and they must agree to the paisa, because §9.2.4 makes
 * the driver's copy an acceptance criterion and §9.3.7 puts the fleet's copy on
 * a screen the same person may also be looking at.
 *
 * Two copies of this SQL is exactly the divergence this codebase keeps warning
 * about: `earnings-projector.ts`'s own docstring says its `EARNING_TYPES` "must
 * stay in step with the third ledger invariant… a divergence would make the
 * projection disagree with the invariant that is supposed to police it".
 *
 * NOTE `driver_share` COALESCES TWO LEG TYPES. A fleet driver is credited
 * `driver_share_credit`; an independent driver is credited the whole pool as a
 * single `fare_credit`. Both are "what the driver got", and summing them here
 * is what lets one query serve both — which is also why the driver feed needs
 * no `fleet_id` and therefore works for the independent drivers `earnings_daily`
 * structurally cannot represent.
 */
export function settlementLateral(): SQL {
  return sql`
        join lateral (
          select min(t.created_at) as settled_at,
                 coalesce(sum(t.amount) filter (
                   where t.type in ('driver_share_credit', 'fare_credit')
                 ), 0) as driver_share,
                 coalesce(sum(t.amount) filter (
                   where t.type = 'fleet_share_credit'
                 ), 0) as fleet_share,
                 coalesce(sum(t.amount) filter (
                   where t.type = 'refund_debit'
                 ), 0) as refunded
            from wallet_transactions t
           where t.ref_id = b.id
             and t.type in ('driver_share_credit', 'fleet_share_credit', 'fare_credit',
                            'refund_debit')
        ) l on true`;
}
