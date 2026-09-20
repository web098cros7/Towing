import { z } from 'zod';
import type { AdminSubRole } from '../common/enums';

/**
 * One permission map, two consumers (guide §3.1, Part 6).
 *
 * Sub-roles alone do not survive twenty screens: `@Roles('super_admin',
 * 'operations')` repeated on 80 routes is unreviewable, and the UI cannot
 * reason about it at all. New admin routes use `@Permissions(...)` (enforced
 * in `JwtAuthGuard` right after the role check); existing routes stay on
 * `@Roles` — no rewrite. The web filters nav and buttons through
 * `useAdminIdentity()` + `<Can>` against this same table.
 *
 * ⚠️ ("limited") rows from the Part 6 table are MEMBERS of the role's list
 * below. "Limited" is never a third truth value here — `adminCan` is boolean
 * on purpose, because a guard cannot enforce "sort of". The limitation lives
 * at the endpoint: e.g. `support` holds `user.suspend.request` (files a
 * request row) but not `user.suspend` (performs it); `finance` holds
 * `user.read` but its endpoints project out finance-sensitive fields; support
 * may read `audit.read` rows for its own actions and subjects it may read.
 * Each such call site documents its own limit; this table only says "may reach
 * the route".
 *
 * The §4.2 transcription test (`admin-permissions-matrix.spec.ts` in the
 * backend) pins this table to the spec: any divergence not listed in its
 * explicit `DEVIATIONS` array fails the suite.
 */
export const ADMIN_PERMISSIONS = [
  'kyc.read',
  'kyc.review',
  'kyc.bulk',
  'user.read',
  'user.suspend',
  'user.suspend.request',
  'driver.capabilities',
  'fleet.suspend',
  'impersonate.read',
  'ops.live',
  'ops.dispatch.inspect',
  'booking.read',
  'booking.cancel',
  'booking.reassign',
  'booking.override',
  'dispute.handle',
  'finance.read',
  'finance.summary',
  'finance.refund',
  'payout.approve',
  'pricing.edit',
  'surge.edit',
  'commission.edit',
  'commission.propose',
  'commission.guardrail',
  'dispatch.config',
  'zone.edit',
  'promo.manage',
  'analytics.view',
  'analytics.export',
  'notification.view',
  'admin.manage',
  'audit.read',
  'sos.handle',
  'ticket.handle',
  'privacy.handle',
  'content.edit',
  'quote.manage',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const adminPermissionSchema = z.enum(ADMIN_PERMISSIONS);

const ALL: readonly AdminPermission[] = ADMIN_PERMISSIONS;

export const ROLE_PERMISSIONS: Record<AdminSubRole, readonly AdminPermission[]> = {
  super_admin: ALL,
  operations: [
    'kyc.read',
    'kyc.review',
    'kyc.bulk',
    'user.read',
    'user.suspend',
    'user.suspend.request',
    'driver.capabilities',
    'fleet.suspend',
    'impersonate.read',
    'ops.live',
    'ops.dispatch.inspect',
    'booking.read',
    'booking.cancel',
    'booking.reassign',
    'dispute.handle',
    'finance.summary',
    'pricing.edit',
    'surge.edit',
    'commission.propose',
    'dispatch.config',
    'zone.edit',
    'promo.manage',
    'analytics.view',
    'analytics.export',
    'notification.view',
    'audit.read',
    'sos.handle',
    'ticket.handle',
    'content.edit',
    'quote.manage',
  ],
  support: [
    'kyc.read',
    'user.read',
    'user.suspend.request',
    'impersonate.read',
    'ops.live',
    'ops.dispatch.inspect',
    'booking.read',
    'dispute.handle',
    'analytics.view',
    'analytics.export',
    'notification.view',
    'audit.read',
    'sos.handle',
    'ticket.handle',
    'privacy.handle',
    'content.edit',
  ],
  finance: [
    'user.read',
    'booking.read',
    'dispute.handle',
    'finance.read',
    'finance.summary',
    'finance.refund',
    'payout.approve',
    'pricing.edit',
    'surge.edit',
    'commission.edit',
    'commission.propose',
    'analytics.view',
    'analytics.export',
    'audit.read',
    'quote.manage',
  ],
};

/** The single predicate both the guard and the UI read. */
export function adminCan(subRole: AdminSubRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[subRole].includes(permission);
}
