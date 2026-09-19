import { useQuery } from '@tanstack/react-query';
import { adminDriversKeys } from './adminDrivers.keys';
import { adminDriversDataSource } from './adminDriversDataSource';

/**
 * The queue is one review at a time, so the page is small on purpose: a
 * 25-row page of five-document cards is a scrolling session, not a queue.
 */
export const ADMIN_KYC_PAGE_SIZE = 10;

export function useAdminPendingDrivers(page: number) {
  return useQuery({
    queryKey: adminDriversKeys.pending(page, ADMIN_KYC_PAGE_SIZE),
    queryFn: () => adminDriversDataSource.pending(page, ADMIN_KYC_PAGE_SIZE),
  });
}

/** W7 — every upload of every document for one driver, newest first. */
export function useAdminDocumentVersions(driverId: string | null) {
  return useQuery({
    queryKey: adminDriversKeys.versions(driverId ?? ''),
    queryFn: () => adminDriversDataSource.versions(driverId!),
    enabled: driverId !== null,
  });
}
