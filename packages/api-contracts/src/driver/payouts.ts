import { z } from 'zod';
import {
  payoutAccountLinkSchema,
  payoutAccountSchema,
} from '../fleet/settings';
import {
  payoutRequestSchema,
  payoutSchema,
  payoutsListResponseSchema,
  payoutsQuerySchema,
} from '../fleet/payouts';

/**
 * §14.4 / §9.2.4 — the driver's payouts.
 *
 * **Almost nothing here is new.** `payouts`, `payout_accounts` and
 * `PayoutProviderPort` have been polymorphic on `(owner_type, owner_id)` since
 * Track A Phase 7, which anticipated this exactly: the port's own docstring
 * says "Track B Phase 19 pays drivers through this same port. `ownerType` is
 * therefore a parameter everywhere rather than an assumption." So the shapes
 * are the fleet's, re-exported rather than re-declared — a driver payout and a
 * fleet payout are the same object with a different owner, and typing them
 * twice is how the console and the app start disagreeing about what `failed`
 * means.
 *
 * The ROUTES are separate (`/v1/driver/payouts`, not `/v1/fleet/payouts`)
 * because the fleet controller's `@CurrentFleet` / `FleetScopeGuard` /
 * `ProfileCompleteGuard` are tenancy machinery a driver has no analogue for.
 * Same data, different doorway.
 */

export {
  payoutSchema as driverPayoutSchema,
  payoutRequestSchema as driverPayoutRequestSchema,
  payoutsQuerySchema as driverPayoutsQuerySchema,
  payoutsListResponseSchema as driverPayoutsListResponseSchema,
};
export type DriverPayoutDto = z.infer<typeof payoutSchema>;
export type DriverPayoutRequest = z.infer<typeof payoutRequestSchema>;
export type DriverPayoutsQuery = z.infer<typeof payoutsQuerySchema>;
export type DriverPayoutsListResponse = z.infer<typeof payoutsListResponseSchema>;

/**
 * Route linked-account onboarding, driver side.
 *
 * The adapter needs no change at all: `RazorpayRouteAdapter.linkAccount`
 * already branches `type: ownerType === 'fleet' ? 'vendor' : 'employee'`.
 * The full account number goes to the provider and is never persisted — only
 * `account_number_last4` and a fingerprint, the rule `payout_accounts`'
 * docstring already sets.
 */
export {
  payoutAccountSchema as driverPayoutAccountSchema,
  payoutAccountLinkSchema as driverPayoutAccountLinkSchema,
};
export type DriverPayoutAccountDto = z.infer<typeof payoutAccountSchema>;
export type DriverPayoutAccountLinkRequest = z.infer<typeof payoutAccountLinkSchema>;
