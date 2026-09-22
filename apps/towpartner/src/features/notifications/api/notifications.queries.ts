import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubjectNotificationPrefsUpdate } from '@towing/api-contracts';
import { notificationsDataSource } from './notificationsDataSource';
import { notificationKeys } from './notifications.keys';
import { notificationPrefsDataSource } from './notificationPrefsDataSource';
import { notificationPrefKeys } from './notificationPrefs.keys';

/** The driver's notification centre feed (§12.1) — the bell in `DriverHeader`. */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(),
    queryFn: ({ pageParam }) => notificationsDataSource.list(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/**
 * The bell's dot. Separate from the list so the six screens that render
 * `DriverHeader` share one cheap cache entry instead of loading a page each.
 */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: () => notificationsDataSource.unreadCount(),
    staleTime: 60_000,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids?: string[]) => notificationsDataSource.markRead(ids),
    onSuccess: (result) => {
      queryClient.setQueryData(notificationKeys.unread(), { unread: result.unread });
      void queryClient.invalidateQueries({ queryKey: notificationKeys.list() });
    },
  });
}

/** §12.3 opt-outs. The always-on categories are not in here by design. */
export function useNotificationPrefs() {
  return useQuery({
    queryKey: notificationPrefKeys.detail(),
    queryFn: () => notificationPrefsDataSource.get(),
  });
}

export function useUpdateNotificationPrefs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: SubjectNotificationPrefsUpdate) =>
      notificationPrefsDataSource.update(patch),
    onSuccess: (prefs) => {
      queryClient.setQueryData(notificationPrefKeys.detail(), prefs);
    },
  });
}
