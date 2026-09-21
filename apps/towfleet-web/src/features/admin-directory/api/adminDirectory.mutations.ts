import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminDriverSuspendBody } from '@towing/api-contracts';
import { adminDirectoryKeys } from './adminDirectory.keys';
import { adminDirectoryDataSource } from './adminDirectoryDataSource';

/**
 * W6's directory writes. Each mutation invalidates everything under
 * `admin-directory` on success — the directory is small, the operations are
 * rare, and a precisely-targeted invalidation that misses one derived list
 * (a fleet's driver count after a driver suspension) is worse than a refetch.
 */
const useDirectoryMutation = <TInput, TResult>(mutate: (input: TInput) => Promise<TResult>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mutate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminDirectoryKeys.all }),
  });
};

export function useSuspendUser() {
  return useDirectoryMutation((input: { userId: string; reason: string }) =>
    adminDirectoryDataSource.suspendUser(input.userId, input.reason),
  );
}

export function useReactivateUser() {
  return useDirectoryMutation((input: { userId: string }) =>
    adminDirectoryDataSource.reactivateUser(input.userId),
  );
}

export function useApproveSuspensionRequest() {
  return useDirectoryMutation((input: { requestId: string; note?: string }) =>
    adminDirectoryDataSource.approveRequest(input.requestId, input.note),
  );
}

export function useRejectSuspensionRequest() {
  return useDirectoryMutation((input: { requestId: string; note?: string }) =>
    adminDirectoryDataSource.rejectRequest(input.requestId, input.note),
  );
}

export function useSuspendDriver() {
  return useDirectoryMutation((input: { driverId: string; body: AdminDriverSuspendBody }) =>
    adminDirectoryDataSource.suspendDriver(input.driverId, input.body),
  );
}

export function useReactivateDriver() {
  return useDirectoryMutation((input: { driverId: string }) =>
    adminDirectoryDataSource.reactivateDriver(input.driverId),
  );
}

export function useUpdateDriverZones() {
  return useDirectoryMutation((input: { driverId: string; zoneIds: string[] }) =>
    adminDirectoryDataSource.updateDriverZones(input.driverId, input.zoneIds),
  );
}

export function useSuspendFleet() {
  return useDirectoryMutation((input: { fleetId: string; reason: string }) =>
    adminDirectoryDataSource.suspendFleet(input.fleetId, input.reason),
  );
}

export function useReactivateFleet() {
  return useDirectoryMutation((input: { fleetId: string }) =>
    adminDirectoryDataSource.reactivateFleet(input.fleetId),
  );
}

export function useStartImpersonation() {
  return useMutation({
    mutationFn: (input: { userId: string; reason: string }) =>
      adminDirectoryDataSource.impersonate(input.userId, input.reason),
  });
}

export function useEndImpersonation() {
  return useMutation({
    mutationFn: (input: { userId: string; sessionId: string }) =>
      adminDirectoryDataSource.endImpersonation(input.userId, input.sessionId),
  });
}
