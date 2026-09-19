'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminSecurityDataSource } from './adminSecurityDataSource';

/**
 * `retry: false`: a timed-out enrolment or confirm may already have applied,
 * and retrying a second factor write blind is how an admin ends up locked out.
 * The operator retries from a refreshed screen.
 */
export function useEnrollTotp() {
  return useMutation({ mutationFn: () => adminSecurityDataSource.enroll(), retry: false });
}

export function useConfirmTotp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => adminSecurityDataSource.confirm(code),
    retry: false,
    // Identity carries `twofaEnabled`, which the console banners off — a
    // confirmed enrolment must refresh it.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-identity'] }),
  });
}

export function useDisableTotp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => adminSecurityDataSource.disable(reason),
    retry: false,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-identity'] }),
  });
}

export function useRecoveryCodes() {
  return useMutation({ mutationFn: () => adminSecurityDataSource.recoveryCodes(), retry: false });
}
