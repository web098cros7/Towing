import type { AdminAuditDetail } from '@towing/api-contracts';

/**
 * W1's audit viewer fixture — one of each interesting shape.
 *
 * Deterministic UUIDs, disjoint from every other admin mock (7/8/9… is W2's
 * admin directory, 4… is W21's notes subject). The actor ids reuse the admin
 * fixture's uuids on purpose: a later W2/W6 joiner can resolve names without
 * renumbering anything.
 *
 * `before: null` on the session revoke exists to exercise the create-like row:
 * the diff must render an empty side rather than "null".
 */
export const adminAuditMock: AdminAuditDetail[] = [
  {
    id: 'c0000001-0001-4000-8000-000000000001',
    adminId: '77777777-7777-4777-8777-777777777777',
    action: 'driver.kyc.approve',
    subjectType: 'driver',
    subjectId: '4a000001-0001-4000-8000-000000000001',
    reason: 'Licence and RC match the vehicle',
    ip: '49.207.14.3',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    createdAt: new Date(Date.now() - 35 * 60_000).toISOString(),
    before: { kycStatus: 'pending' },
    after: { kycStatus: 'approved' },
  },
  {
    id: 'c0000002-0002-4000-8000-000000000002',
    adminId: '88888888-8888-4888-8888-888888888888',
    action: 'payout.approve',
    subjectType: 'payout',
    subjectId: '4a000002-0002-4000-8000-000000000002',
    reason: 'Bank proof received',
    ip: '49.207.14.9',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    createdAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
    before: { approvalState: 'pending_approval', amount: '42000.00' },
    after: { approvalState: 'approved', amount: '42000.00' },
  },
  {
    id: 'c0000003-0003-4000-8000-000000000003',
    adminId: '88888888-8888-4888-8888-888888888888',
    action: 'fleet.suspend',
    subjectType: 'fleet',
    subjectId: '4a000003-0003-4000-8000-000000000003',
    reason: 'Repeated compliance failures',
    ip: '49.207.14.9',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    createdAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
    before: { status: 'active' },
    after: { status: 'suspended' },
  },
  {
    id: 'c0000004-0004-4000-8000-000000000004',
    adminId: '88888888-8888-4888-8888-888888888888',
    action: 'admin.session_revoke',
    subjectType: 'admin',
    subjectId: '99999999-9999-4999-8999-999999999999',
    reason: null,
    ip: '49.207.14.9',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
    before: null,
    after: { sessionId: '4a000004-0004-4000-8000-000000000004', revoked: true },
  },
  {
    id: 'c0000005-0005-4000-8000-000000000005',
    adminId: '77777777-7777-4777-8777-777777777777',
    action: 'pricing.edit',
    subjectType: 'pricing',
    subjectId: '4a000005-0005-4000-8000-000000000005',
    reason: 'Fuel revision from the board',
    ip: '49.207.14.3',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString(),
    before: { bandAPct: '12.00' },
    after: { bandAPct: '12.50' },
  },
];

/** The list projection — what the feed returns (no before/after). */
export function toAdminAuditEntry(detail: AdminAuditDetail) {
  const { before: _before, after: _after, ...entry } = detail;
  return entry;
}
