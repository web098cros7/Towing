import type { AdminNotificationDeliveriesQuery } from '@towing/api-contracts';

export const adminNotificationsKeys = {
  all: ['admin-notifications'] as const,
  templates: () => [...adminNotificationsKeys.all, 'templates'] as const,
  deliveries: (query: Partial<AdminNotificationDeliveriesQuery>) =>
    [...adminNotificationsKeys.all, 'deliveries', query] as const,
};
