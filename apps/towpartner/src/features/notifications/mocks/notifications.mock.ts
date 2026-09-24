import type { NotificationDto } from '@towing/api-contracts';

/**
 * Mock inbox rows for the driver bell.
 *
 * ⚠ Every `event` here is a REAL registry key — `driver.kyc.approved` is the
 * one Phase 13 actually emits, and it is what `handleNotificationData` switches
 * on to unlock the online toggle. A fixture that invented its own would let the
 * handler pass in mock mode and do nothing against the real backend.
 *
 * `payout.processed` is registered too; `job.offered` is the §12.2 row Phase 17
 * emits, present so the screen has realistic variety under the exact key that
 * phase will use.
 */
export const MOCK_NOTIFICATIONS: NotificationDto[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    event: 'driver.kyc.approved',
    category: 'transactional',
    title: 'You are verified',
    body: 'Your documents are approved. You can start earning now — go online to receive jobs.',
    data: {
      event: 'driver.kyc.approved',
      notificationId: '00000000-0000-4000-8000-000000000001',
      action: 'refetch',
      invalidate: 'driver.kyc',
      route: 'mitowdriver://kyc',
    },
    readAt: null,
    createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    event: 'payout.processed',
    category: 'money',
    title: 'Payout sent',
    body: 'Your payout of ₹4,820 is on its way to your bank account.',
    data: {
      event: 'payout.processed',
      notificationId: '00000000-0000-4000-8000-000000000002',
      action: 'open',
      route: 'mitowdriver://earnings',
    },
    readAt: null,
    createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    event: 'job.offered',
    category: 'job',
    title: 'Job completed',
    body: 'Flatbed tow from Koramangala — ₹1,180 net added to your earnings.',
    data: {
      event: 'job.offered',
      notificationId: '00000000-0000-4000-8000-000000000003',
      action: 'open',
      route: 'mitowdriver://jobs',
    },
    readAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
];
