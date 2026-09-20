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
  /**
   * W10/W11/W12 config changes. These rows are written by the config writers
   * themselves with the whole before/after, and the subject map is what lets an
   * admin who holds the matching permission see a colleague's change on that
   * subject. `app_config` rides `dispatch.config` because the SEV banner and
   * the kill switches are the same operational lever.
   */
  pricing_config: 'pricing.edit',
  commission_config: 'commission.edit',
  dispatch_config: 'dispatch.config',
  app_config: 'dispatch.config',
  /**
   * W16 promotions. The rows are written by `promo.manage` holders and read
   * back by the same pair — the subject map is what lets one operator see the
   * other's coupon/banner change on the audit feed.
   */
  coupon: 'promo.manage',
  banner: 'promo.manage',
  /**
   * W19 retention edits. No single subject row to point at — the audit row's
   * subject id is null and the policy key travels in before/after — but the
   * subject TYPE is what the console's audit feed filters on, so the mapping
   * has to exist for anyone to read these rows back.
   */
  privacy_retention: 'privacy.handle',
  /**
   * W20 manual quotes. Operators write and read these rows, so the subject map
   * grants every `quote.manage` holder visibility of the others' pricing — the
   * feed is how a second operator sees why a customer was offered what they
   * were.
   */
  quote: 'quote.manage',
};

export function canReadSubject(subRole: AdminSubRole, subjectType: string): boolean {
  const permission = SUBJECT_READ_PERMISSION[subjectType];
  return permission !== undefined && adminCan(subRole, permission);
}
