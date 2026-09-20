import type {
  AdminNotificationDeliveriesQuery,
  AdminNotificationDeliveriesResponse,
  AdminNotificationTemplatesResponse,
  AdminNotificationTestSend,
  AdminNotificationTestSendResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import {
  mockDeliveries,
  mockTemplates,
  mockTestSend,
} from '../mocks/adminNotifications.mock';

/**
 * W18's notification console APIs (§12.3).
 *
 * The test-send is the only write, and the mock resolves it locally so the
 * confirmation state is walkable; the REAL send is proven by the backend spec
 * (super-admin gate, masked destination, audit row) and the live look.
 */
export interface AdminNotificationsDataSource {
  templates(): Promise<AdminNotificationTemplatesResponse>;
  deliveries(query: AdminNotificationDeliveriesQuery): Promise<AdminNotificationDeliveriesResponse>;
  testSend(body: AdminNotificationTestSend): Promise<AdminNotificationTestSendResponse>;
}

const mockSource: AdminNotificationsDataSource = {
  templates: async () => {
    await mockDelay(200);
    return resolveMock(env.mockAdminNotificationsState, mockTemplates(), { items: [] });
  },
  deliveries: async (query) => {
    await mockDelay(200);
    return resolveMock(env.mockAdminNotificationsState, mockDeliveries(query), {
      items: [],
      page: query.page,
      limit: query.limit,
      total: 0,
      deadLetterDepth: 0,
    });
  },
  testSend: async (body) => {
    await mockDelay(400);
    return mockTestSend(body);
  },
};

const restSource: AdminNotificationsDataSource = {
  templates: () => adminApiFetch<AdminNotificationTemplatesResponse>('notifications/templates'),
  deliveries: (query) => {
    const params = new URLSearchParams({
      page: String(query.page),
      limit: String(query.limit),
    });
    if (query.status) params.set('status', query.status);
    if (query.channel) params.set('channel', query.channel);
    if (query.event) params.set('event', query.event);
    return adminApiFetch<AdminNotificationDeliveriesResponse>(
      `notifications/deliveries?${params.toString()}`,
    );
  },
  testSend: (body) =>
    adminApiFetch<AdminNotificationTestSendResponse>('notifications/test-send', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export const adminNotificationsDataSource: AdminNotificationsDataSource = env.useMocks
  ? mockSource
  : restSource;
