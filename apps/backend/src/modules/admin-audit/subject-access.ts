import { adminCan, type AdminPermission, type AdminSubRole } from '@towing/api-contracts';

/**
 * Which subject-scoped reads a subject type unlocks (§3.5: "subject-scoped
 * reads follow whoever may read the subject"). Shared by the audit viewer and
 * admin notes so one screen's timeline and its notes panel cannot disagree
 * about what the viewer is allowed to see.
 *
 * Each mapping reuses the SAME permission the subject's own screens are gated
 * on — `user.read` is the directory read for drivers/users/fleets; `kyc.read`
 * is deliberately NOT used for `driver` because finance holds `user.read` and
 * not `kyc.read`, and finance does need suspension history on a driver.
 *
 * A subject type NOT in this map has no cross-admin readers: only the actor who
 * wrote the row sees it. That is the fail-closed default, and it is what makes
 * this map a gate rather than a comment.
 */
export const SUBJECT_READ_PERMISSION: Record<string, AdminPermission> = {
  admin: 'admin.manage',
  booking: 'booking.read',
  dispute: 'dispute.handle',
  payout: 'finance.read',
  refund: 'finance.read',
  driver: 'user.read',
  /**
   * W7: per-document decisions are the KYC drawer's own history, and `kyc.read`
   * is that screen's gate — the same rule as `driver` above, which deliberately
   * uses `user.read` instead because finance needs suspension history and holds
   * no `kyc.read`.
   */
  driver_document: 'kyc.read',
  user: 'user.read',
  fleet: 'user.read',
  truck: 'user.read',
  sos_alert: 'sos.handle',
  support_ticket: 'ticket.handle',
  deletion_request: 'privacy.handle',
};

export function canReadSubject(subRole: AdminSubRole, subjectType: string): boolean {
  const permission = SUBJECT_READ_PERMISSION[subjectType];
  return permission !== undefined && adminCan(subRole, permission);
}
