'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminCreateAdmin, AdminDeactivateAdmin, AdminUpdateAdmin } from '@towing/api-contracts';
import { adminAdminsKeys } from './adminAdmins.keys';
import { adminAdminsDataSource } from './adminAdminsDataSource';

/**
 * `retry: false` everywhere here, for the finance-queue reason documented in
 * `adminFinance.mutations.ts`: a timed-out write may already have applied
 * (the temp password is already out of band), and a blind retry would mint a
 * second credential the operator never sees.
 */
function useInvalidateAdmins() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminAdminsKeys.all });
  };
}

export function useCreateAdmin() {
  const invalidate = useInvalidateAdmins();
  return useMutation({
    mutationFn: (body: AdminCreateAdmin) => adminAdminsDataSource.create(body),
    retry: false,
    onSuccess: () => invalidate(),
  });
}

export function useUpdateAdmin() {
  const invalidate = useInvalidateAdmins();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AdminUpdateAdmin }) =>
      adminAdminsDataSource.update(id, body),
    retry: false,
    onSuccess: () => invalidate(),
  });
}

export function useDeactivateAdmin() {
  const invalidate = useInvalidateAdmins();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AdminDeactivateAdmin }) =>
      adminAdminsDataSource.deactivate(id, body),
    retry: false,
    onSuccess: () => invalidate(),
  });
}

export function useReactivateAdmin() {
  const invalidate = useInvalidateAdmins();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AdminDeactivateAdmin }) =>
      adminAdminsDataSource.reactivate(id, body),
    retry: false,
    onSuccess: () => invalidate(),
  });
}

export function useResetAdminPassword() {
  const invalidate = useInvalidateAdmins();
  return useMutation({
    mutationFn: (id: string) => adminAdminsDataSource.resetPassword(id),
    retry: false,
    onSuccess: () => invalidate(),
  });
}
