import type {
  AdminDeletionRequest,
  AdminDeletionRequestsQuery,
  AdminDeletionRequestsResponse,
  AdminRetentionPoliciesResponse,
  AdminRetentionPolicy,
  AdminRetentionUpdate,
  AdminSubjectExportResponse,
  AdminUserCorrection,
  AdminUserCorrectionResponse,
} from '@towing/api-contracts';

/**
 * W19's mock. Deterministic, shaped exactly like the API.
 *
 * The queue mirrors the three states that matter on screen: an open request
 * (approve/hold), one PARKED with a reason (the hold's whole point), and one
 * COMPLETED carrying the six-step erasure log — the panel's evidence view has
 * nothing to render without a finished job.
 *
 * Mutations return plausible results and do NOT persist (the house mock rule):
 * the UI re-reads on success, so what the e2e asserts is the toast and the
 * returned row, not a store this file would have to keep coherent.
 */

const USER_ID = '00000000-0000-4000-8000-0000000000a1';
const DRIVER_ID = '00000000-0000-4000-8000-0000000000b2';

const REQUESTS: AdminDeletionRequest[] = [
  {
    id: '00000000-0000-4000-8000-0000000000c1',
    subjectType: 'user',
    subjectId: USER_ID,
    subjectLabel: 'Ravi Kumar',
    status: 'requested',
    reason: 'No longer needed',
    holdReason: null,
    decidedBy: null,
    decidedAt: null,
    executedAt: null,
    anonymisedAt: null,
    requestedAt: '2026-08-19T04:12:00.000Z',
    updatedAt: '2026-08-19T04:12:00.000Z',
    latestJob: null,
  },
  {
    id: '00000000-0000-4000-8000-0000000000c2',
    subjectType: 'driver',
    subjectId: DRIVER_ID,
    subjectLabel: 'Ganesh Patil',
    status: 'on_hold',
    reason: 'Switching to another app',
    holdReason: 'open_payout:1',
    decidedBy: null,
    decidedAt: null,
    executedAt: null,
    anonymisedAt: null,
    requestedAt: '2026-08-18T11:40:00.000Z',
    updatedAt: '2026-08-18T12:02:00.000Z',
    latestJob: {
      id: '00000000-0000-4000-8000-0000000000d2',
      status: 'failed',
      steps: [
        {
          step: 'holds',
          outcome: 'refused',
          count: 1,
          detail: 'open_payout:1',
          at: '2026-08-18T12:02:00.000Z',
        },
      ],
      error: 'open_payout:1',
      startedAt: '2026-08-18T12:02:00.000Z',
      finishedAt: '2026-08-18T12:02:00.000Z',
      createdAt: '2026-08-18T12:02:00.000Z',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000000c3',
    subjectType: 'user',
    subjectId: '00000000-0000-4000-8000-0000000000a3',
    subjectLabel: null,
    status: 'completed',
    reason: null,
    holdReason: null,
    decidedBy: '00000000-0000-4000-8000-000000000001',
    decidedAt: '2026-08-17T06:00:00.000Z',
    executedAt: '2026-08-17T06:20:00.000Z',
    anonymisedAt: '2026-08-17T06:20:00.000Z',
    requestedAt: '2026-08-16T09:00:00.000Z',
    updatedAt: '2026-08-17T06:20:00.000Z',
    latestJob: {
      id: '00000000-0000-4000-8000-0000000000d3',
      status: 'completed',
      steps: [
        {
          step: 'holds',
          outcome: 'done',
          count: 0,
          detail: 'no live booking, no open payout',
          at: '2026-08-17T06:20:00.000Z',
        },
        {
          step: 'revoke_sessions',
          outcome: 'done',
          count: 2,
          detail: 'customer realm',
          at: '2026-08-17T06:20:00.000Z',
        },
        {
          step: 'anonymise_identity',
          outcome: 'done',
          count: 1,
          detail: 'deleted:…',
          at: '2026-08-17T06:20:00.000Z',
        },
        {
          step: 'erase_records',
          outcome: 'done',
          count: 9,
          detail: '1 storage object(s), 1 device(s)',
          at: '2026-08-17T06:20:00.000Z',
        },
        {
          step: 'erase_booking_pii',
          outcome: 'done',
          count: 4,
          detail: '3 booking(s) scrubbed',
          at: '2026-08-17T06:20:00.000Z',
        },
        { step: 'complete', outcome: 'done', count: 0, at: '2026-08-17T06:20:00.000Z' },
      ],
      error: null,
      startedAt: '2026-08-17T06:20:00.000Z',
      finishedAt: '2026-08-17T06:20:00.000Z',
      createdAt: '2026-08-17T06:20:00.000Z',
    },
  },
];

/**
 * Transitions made during this browser session, so the WALK works: a workflow
 * screen whose approve button does not change the row would be untestable
 * end-to-end. Never persisted anywhere else — a reload keeps them (module
 * state), a new tab does not, and the real state machine is the backend's.
 */
const OVERRIDES = new Map<string, Partial<AdminDeletionRequest>>();

function withOverrides(request: AdminDeletionRequest): AdminDeletionRequest {
  return { ...request, ...(OVERRIDES.get(request.id) ?? {}) };
}

export function mockDeletionRequests(
  query: Partial<AdminDeletionRequestsQuery>,
): AdminDeletionRequestsResponse {
  const filtered = REQUESTS.map(withOverrides).filter(
    (row) =>
      (!query.status || row.status === query.status) &&
      (!query.subjectType || row.subjectType === query.subjectType),
  );
  const page = query.page ?? 1;
  const limit = query.limit ?? 25;
  return {
    items: filtered.slice((page - 1) * limit, page * limit),
    page,
    limit,
    total: filtered.length,
  };
}

export function mockDeletionRequest(
  id: string,
  overrides: Partial<AdminDeletionRequest> = {},
): AdminDeletionRequest {
  const base = REQUESTS.find((row) => row.id === id) ?? REQUESTS[0]!;
  return { ...withOverrides(base), ...overrides };
}

/** Records a transition for the rest of the session (see `OVERRIDES`). */
export function rememberDeletionTransition(
  id: string,
  overrides: Partial<AdminDeletionRequest>,
): AdminDeletionRequest {
  OVERRIDES.set(id, { ...(OVERRIDES.get(id) ?? {}), ...overrides });
  return mockDeletionRequest(id);
}

const POLICY_META: Array<{ key: string; days: number; enforced: boolean; description: string }> = [
  {
    key: 'audit_logs',
    days: 2555,
    enforced: false,
    description:
      'admin_actions — 7 years. Policy-only: the erasure runner must never touch the audit trail.',
  },
  {
    key: 'delivery_logs',
    days: 90,
    enforced: true,
    description: 'notification_deliveries and notification_events — 90 days. Swept nightly.',
  },
  {
    key: 'kyc_documents',
    days: 2555,
    enforced: false,
    description:
      'KYC documents and versions — 7 years, regulatory floor. Policy-only: no sweep deletes them.',
  },
  {
    key: 'location_paths',
    days: 180,
    enforced: true,
    description: 'booking_location_path samples — 180 days. Swept nightly.',
  },
  {
    key: 'wave_logs',
    days: 30,
    enforced: false,
    description: 'dispatch_wave_logs — 30 days, purged by the analytics rollup job (§22.2).',
  },
  {
    key: 'webhook_events',
    days: 90,
    enforced: true,
    description: 'Raw provider webhook payloads — 90 days. Swept nightly.',
  },
];

export function mockRetention(
  overrides: AdminRetentionUpdate['policies'] = [],
): AdminRetentionPoliciesResponse {
  const byKey = new Map(overrides.map((policy) => [policy.policyKey, policy.retentionDays]));
  const items: AdminRetentionPolicy[] = POLICY_META.map((policy) => ({
    policyKey: policy.key,
    retentionDays: byKey.get(policy.key) ?? policy.days,
    description: policy.description,
    enforced: policy.enforced,
    updatedAt: '2026-08-01T00:00:00.000Z',
  }));
  return { items };
}

export function mockSubjectExport(): AdminSubjectExportResponse {
  return {
    subjectType: 'user',
    subjectId: USER_ID,
    generatedAt: new Date().toISOString(),
    profile: {
      id: USER_ID,
      mobile: '+919900000101',
      name: 'Ravi Kumar',
      email: 'ravi@example.com',
    },
    vehicles: [{ id: 'v1', type: 'hatchback', plate: 'KA-01-AB-1234' }],
    addresses: [{ id: 'a1', fullAddress: '12 MG Road, Bengaluru' }],
    emergencyContacts: [{ id: 'e1', name: 'Sister', phone: '9900000000' }],
    consents: [
      {
        policyType: 'privacy_policy',
        policyVersion: '2026-08-10',
        consentedAt: '2026-08-10T00:00:00.000Z',
      },
    ],
    bookings: [
      {
        id: '00000000-0000-4000-8000-0000000000f1',
        status: 'paid',
        total: '1450.00',
        createdAt: '2026-08-01T09:00:00.000Z',
        completedAt: '2026-08-01T10:00:00.000Z',
      },
    ],
  };
}

export function mockUserCorrection(body: AdminUserCorrection): AdminUserCorrectionResponse {
  return {
    id: USER_ID,
    name: body.name ?? 'Ravi Kumar',
    email: body.email ?? 'ravi@example.com',
    mobile: body.mobile ?? '+919900000101',
  };
}
