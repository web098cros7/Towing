import type { AdminActiveSession } from '@towing/api-contracts';

/**
 * W1's session list fixture — two live sessions, so the "sign out everywhere"
 * affordance has something to point at.
 *
 * The second row is deliberately older and from another user agent: a list
 * where every row looks like the current browser cannot show the reader what
 * the list is FOR.
 */
export const adminSessionsMock: AdminActiveSession[] = [
  {
    id: 'e0000001-0001-4000-8000-000000000001',
    ip: '49.207.14.9',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/139.0',
    createdAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    lastUsedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 11 * 60 * 60_000).toISOString(),
  },
  {
    id: 'e0000002-0002-4000-8000-000000000002',
    ip: '49.207.14.31',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
    createdAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
    lastUsedAt: new Date(Date.now() - 55 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 9 * 60 * 60_000).toISOString(),
  },
];
