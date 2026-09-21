import {
  ADMIN_PERMISSIONS,
  ROLE_PERMISSIONS,
  adminCan,
  type AdminPermission,
  type AdminSubRole,
} from '@towing/api-contracts';
import { describe, expect, it } from 'vitest';

/**
 * The §4.2 permission matrix, transcribed verbatim — this table and the code
 * may only diverge through `DEVIATIONS` below (the same discipline the §12.2
 * notification matrix keeps in `matrix-12-2.ts`).
 *
 * `full` = every holder may act · `limited` = may reach the route but the
 * endpoint constrains what happens (documented per call site; `adminCan`
 * stays boolean) · `none` = the guard refuses.
 *
 * Source: `docs/Towing-Project-Specification_v3.md` §4.2 "Admin Sub-Roles &
 * Permission Matrix". Row order and cell values are the spec's, not ours.
 */
const SPEC_42: ReadonlyArray<{
  capability: string;
  super: 'full' | 'limited' | 'none';
  ops: 'full' | 'limited' | 'none';
  support: 'full' | 'limited' | 'none';
  finance: 'full' | 'limited' | 'none';
}> = [
  {
    capability: 'Approve/Reject KYC',
    super: 'full',
    ops: 'full',
    support: 'none',
    finance: 'none',
  },
  {
    capability: 'Suspend/Reactivate users',
    super: 'full',
    ops: 'full',
    support: 'limited',
    finance: 'none',
  },
  {
    capability: 'Edit pricing & surge',
    super: 'full',
    ops: 'full',
    support: 'none',
    finance: 'none',
  },
  {
    capability: 'Edit commission bands (within guardrail)',
    super: 'full',
    ops: 'limited',
    support: 'none',
    finance: 'full',
  },
  {
    capability: 'Edit commission guardrail (floor/cap)',
    super: 'full',
    ops: 'none',
    support: 'none',
    finance: 'none',
  },
  {
    capability: 'Live ops monitoring',
    super: 'full',
    ops: 'full',
    support: 'full',
    finance: 'none',
  },
  {
    capability: 'Cancel / reassign bookings',
    super: 'full',
    ops: 'full',
    support: 'limited',
    finance: 'none',
  },
  {
    capability: 'Handle disputes / refunds',
    super: 'full',
    ops: 'full',
    support: 'full',
    finance: 'full',
  },
  { capability: 'Approve payouts', super: 'full', ops: 'none', support: 'none', finance: 'full' },
  {
    capability: 'View finance / ledger',
    super: 'full',
    ops: 'limited',
    support: 'none',
    finance: 'full',
  },
  {
    capability: 'Manage admins & roles',
    super: 'full',
    ops: 'none',
    support: 'none',
    finance: 'none',
  },
  {
    capability: 'Manage promotions/coupons',
    super: 'full',
    ops: 'full',
    support: 'none',
    finance: 'none',
  },
  {
    capability: 'Export analytics',
    super: 'full',
    ops: 'full',
    support: 'limited',
    finance: 'full',
  },
];

/**
 * Every place the code deliberately differs from the table above. A reason is
 * mandatory — an entry without one fails the suite, so "temporary" drift
 * cannot be committed quietly. Removing a deviation means changing the code
 * back to the spec, never deleting the row.
 */
const DEVIATIONS: ReadonlyArray<{
  permission: AdminPermission;
  deviation: string;
  reason: string;
}> = [
  {
    permission: 'pricing.edit',
    deviation: 'finance holds it; §4.2 grants Super + Ops only',
    reason:
      'G1 default (Super + Ops + Finance): the shipped code already grants finance and an existing role-matrix test pins it — following the spec literally would revoke live access',
  },
  {
    permission: 'surge.edit',
    deviation: 'finance holds it; §4.2 grants Super + Ops only',
    reason: 'G1 default, same as pricing.edit — one decision covers both halves of §9.4.8',
  },
  {
    permission: 'finance.refund',
    deviation:
      'ops and support do NOT hold it although §4.2 gives all four "Handle disputes / refunds"',
    reason:
      'Money movement is narrower than dispute handling by design: ops/support resolve the dispute, only finance/super_admin move the money (W8/W9)',
  },
  {
    permission: 'commission.guardrail',
    deviation: 'super_admin-only permission exists although no code path enforces it yet',
    reason:
      'Matches spec §2.4/§4.2 against the shipped code, which hard-codes the guardrail — W11 implements the editable guardrail (G2)',
  },
];

const SUB_ROLES: readonly AdminSubRole[] = ['super_admin', 'operations', 'support', 'finance'];

function holds(subRole: AdminSubRole, permission: AdminPermission): boolean {
  return adminCan(subRole, permission);
}

describe('admin permissions (§4.2 matrix)', () => {
  it('lists every permission exactly once', () => {
    expect(new Set(ADMIN_PERMISSIONS).size).toBe(ADMIN_PERMISSIONS.length);
  });

  it('grants every permission to at least one sub-role, and every sub-role something', () => {
    for (const permission of ADMIN_PERMISSIONS) {
      expect(
        SUB_ROLES.some((subRole) => holds(subRole, permission)),
        `${permission} is granted to nobody`,
      ).toBe(true);
    }
    for (const subRole of SUB_ROLES) {
      expect(ROLE_PERMISSIONS[subRole].length).toBeGreaterThan(0);
    }
  });

  it('every DEVIATIONS entry carries a written reason', () => {
    expect(DEVIATIONS.length).toBeGreaterThan(0);
    for (const entry of DEVIATIONS) {
      expect(entry.reason.trim().length, `${entry.permission} has no reason`).toBeGreaterThan(0);
      expect(ADMIN_PERMISSIONS).toContain(entry.permission);
    }
  });

  it('Approve/Reject KYC: super_admin + operations hold kyc.review, nobody else', () => {
    expect(SPEC_42[0]!.support).toBe('none');
    for (const subRole of ['super_admin', 'operations'] as const) {
      expect(holds(subRole, 'kyc.review')).toBe(true);
      // W7 gated the bulk route on kyc.bulk rather than on kyc.review: it is
      // the same pair of sub-roles, and the separate permission is what the
      // §4.2 table already carries ("new" for the bulk action).
      expect(holds(subRole, 'kyc.bulk')).toBe(true);
    }
    for (const subRole of ['support', 'finance'] as const) {
      expect(holds(subRole, 'kyc.review')).toBe(false);
      expect(holds(subRole, 'kyc.bulk')).toBe(false);
    }
    // Support reads the queue and the documents, and decides nothing.
    expect(holds('support', 'kyc.read')).toBe(true);
    expect(holds('finance', 'kyc.read')).toBe(false);
  });

  it('Suspend/Reactivate: support may request (user.suspend.request) but never perform (user.suspend)', () => {
    expect(holds('support', 'user.suspend.request')).toBe(true);
    expect(holds('support', 'user.suspend')).toBe(false);
    expect(holds('support', 'fleet.suspend')).toBe(false);
    expect(holds('finance', 'user.suspend')).toBe(false);
    expect(holds('finance', 'user.suspend.request')).toBe(false);
  });

  it('Pricing & surge: Super + Ops per spec, finance per G1 deviation, never support', () => {
    for (const permission of ['pricing.edit', 'surge.edit'] as const) {
      expect(holds('super_admin', permission)).toBe(true);
      expect(holds('operations', permission)).toBe(true);
      expect(holds('finance', permission)).toBe(true);
      expect(holds('support', permission)).toBe(false);
    }
  });

  it('Commission: bands SA+finance, propose adds operations, guardrail SA-only', () => {
    expect(holds('super_admin', 'commission.edit')).toBe(true);
    expect(holds('finance', 'commission.edit')).toBe(true);
    expect(holds('operations', 'commission.edit')).toBe(false);
    expect(holds('support', 'commission.edit')).toBe(false);
    expect(holds('operations', 'commission.propose')).toBe(true);
    expect(holds('finance', 'commission.propose')).toBe(true);
    for (const subRole of ['operations', 'support', 'finance'] as const) {
      expect(holds(subRole, 'commission.guardrail')).toBe(false);
    }
    expect(holds('super_admin', 'commission.guardrail')).toBe(true);
  });

  it('Live ops: everyone except finance; booking cancel/reassign never support directly', () => {
    expect(holds('finance', 'ops.live')).toBe(false);
    expect(holds('finance', 'ops.dispatch.inspect')).toBe(false);
    for (const subRole of ['super_admin', 'operations', 'support'] as const) {
      expect(holds(subRole, 'ops.live')).toBe(true);
    }
    expect(holds('support', 'booking.cancel')).toBe(false);
    expect(holds('support', 'booking.reassign')).toBe(false);
    expect(holds('super_admin', 'booking.override')).toBe(true);
    for (const subRole of ['operations', 'support', 'finance'] as const) {
      expect(holds(subRole, 'booking.override')).toBe(false);
    }
  });

  it('Money: payouts and ledger SA+finance; refunds narrower than disputes per deviation', () => {
    expect(holds('operations', 'payout.approve')).toBe(false);
    expect(holds('finance', 'payout.approve')).toBe(true);
    expect(holds('operations', 'finance.read')).toBe(false);
    expect(holds('operations', 'finance.summary')).toBe(true);
    // Disputes are all-four; moving money is not.
    for (const subRole of SUB_ROLES) {
      expect(holds(subRole, 'dispute.handle')).toBe(true);
    }
    expect(holds('operations', 'finance.refund')).toBe(false);
    expect(holds('support', 'finance.refund')).toBe(false);
    expect(holds('finance', 'finance.refund')).toBe(true);
  });

  it('Admin management is super_admin-only; promos Ops; analytics all-four', () => {
    for (const subRole of ['operations', 'support', 'finance'] as const) {
      expect(holds(subRole, 'admin.manage')).toBe(false);
    }
    expect(holds('operations', 'promo.manage')).toBe(true);
    expect(holds('support', 'promo.manage')).toBe(false);
    expect(holds('finance', 'promo.manage')).toBe(false);
    for (const subRole of SUB_ROLES) {
      expect(holds(subRole, 'analytics.export')).toBe(true);
    }
  });

  it('Cross-cutting: audit readable by all (own + readable subjects enforced at the route), SOS/tickets/content Ops+support, privacy triage for support only', () => {
    for (const subRole of SUB_ROLES) {
      expect(holds(subRole, 'audit.read')).toBe(true);
    }
    for (const permission of ['sos.handle', 'ticket.handle', 'content.edit'] as const) {
      expect(holds('super_admin', permission)).toBe(true);
      expect(holds('operations', permission)).toBe(true);
      expect(holds('support', permission)).toBe(true);
      expect(holds('finance', permission)).toBe(false);
    }
    expect(holds('support', 'privacy.handle')).toBe(true);
    expect(holds('operations', 'privacy.handle')).toBe(false);
    expect(holds('finance', 'privacy.handle')).toBe(false);
  });

  it('W17/W18: analytics.view is all-four (the ops.live ∪ finance.read union), notification.view Ops+support; test-send stays admin.manage', () => {
    // The guide's Part 6 reads "viewing needs ops.live or finance.read" — the
    // guard is AND-only, so the union is its own permission. Every sub-role
    // holds it; export stays separate on analytics.export.
    for (const subRole of SUB_ROLES) {
      expect(holds(subRole, 'analytics.view')).toBe(true);
    }
    for (const subRole of ['super_admin', 'operations', 'support'] as const) {
      expect(holds(subRole, 'notification.view')).toBe(true);
    }
    expect(holds('finance', 'notification.view')).toBe(false);
    // W18's test-send is super-admin only; admin.manage already expresses that.
    expect(holds('operations', 'admin.manage')).toBe(false);
    expect(holds('super_admin', 'admin.manage')).toBe(true);
  });
});
