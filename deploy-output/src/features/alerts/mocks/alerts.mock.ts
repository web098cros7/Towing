import type { StoredAlert } from '../types';

const HOUR = 3_600_000;

/** Mirrors what the compliance sweep produces against the seeded fleet. */
export const alertsMock: StoredAlert[] = [
  {
    id: 'al-1',
    type: 'doc_expired',
    severity: 'error',
    message: 'Insurance expired for KA-01-AB-1234 — truck removed from dispatch',
    href: '/trucks',
    createdAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    resolvedAt: null,
  },
  {
    id: 'al-2',
    type: 'doc_expiring',
    severity: 'warning',
    message: 'Permit for KA-51-KL-9012 expires in 25 days',
    href: '/trucks',
    createdAt: new Date(Date.now() - 5 * HOUR).toISOString(),
    resolvedAt: null,
  },
  {
    id: 'al-3',
    type: 'doc_expiring',
    severity: 'warning',
    message: 'PUC for KA-05-MJ-7788 expires in 12 days',
    href: '/trucks',
    createdAt: new Date(Date.now() - 9 * HOUR).toISOString(),
    resolvedAt: null,
  },
  {
    id: 'al-4',
    type: 'payout_failed',
    severity: 'error',
    message: 'Payout of ₹42,300.00 failed — check bank details',
    href: '/earnings',
    createdAt: new Date(Date.now() - 26 * HOUR).toISOString(),
    resolvedAt: null,
  },
  {
    // Resolved, so it only shows with the "include resolved" toggle — which is
    // what makes that toggle demonstrable in mock mode.
    id: 'al-5',
    type: 'doc_expired',
    severity: 'error',
    message: 'RC expired for KA-19-TN-3344 — truck removed from dispatch',
    href: '/trucks',
    createdAt: new Date(Date.now() - 72 * HOUR).toISOString(),
    resolvedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
  },
];
