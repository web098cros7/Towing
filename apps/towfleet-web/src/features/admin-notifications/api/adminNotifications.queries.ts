'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminNotificationDeliveriesQuery,
  AdminNotificationTestSend,
} from '@towing/api-contracts';
import { adminNotificationsKeys } from './adminNotifications.keys';
import { adminNotificationsDataSource } from './adminNotificationsDataSource';

export function useNotificationTemplates() {
  return useQuery({
    queryKey: adminNotificationsKeys.templates(),
    queryFn: () => adminNotificationsDataSource.templates(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useNotificationDeliveries(query: AdminNotificationDeliveriesQuery) {
  return useQuery({
    queryKey: adminNotificationsKeys.deliveries(query),
    queryFn: () => adminNotificationsDataSource.deliveries(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useNotificationTestSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminNotificationTestSend) => adminNotificationsDataSource.testSend(body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminNotificationsKeys.all }),
  });
}
