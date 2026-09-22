'use client';

import { useQuery } from '@tanstack/react-query';
import { adminSecurityKeys } from './adminSecurity.keys';
import { adminSecurityDataSource } from './adminSecurityDataSource';

/**
 * The caller's live sessions (W1 §3.6).
 *
 * `refetchOnMount: 'always'` rather than a staleTime tweak: "which devices are
 * signed in as me" is exactly the question where a cached answer is the wrong
 * answer, and the endpoint is a single indexed read.
 */
export function useAdminSessions() {
  return useQuery({
    queryKey: adminSecurityKeys.sessions(),
    queryFn: () => adminSecurityDataSource.sessions(),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}
