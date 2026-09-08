import type { JobsListResponse } from '@towing/api-contracts';
import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { resolveMock } from '@/lib/mockUtils';
import { jobsMock } from '../mocks/jobs.mock';
import type { Job, JobStatus } from '../types';

export type JobsFilter = {
  status?: JobStatus | 'all';
};

export interface JobsDataSource {
  list(filter: JobsFilter): Promise<Job[]>;
}

const mockSource: JobsDataSource = {
  list: async (filter) => {
    const all = await resolveMock(env.mockJobsState, jobsMock, []);
    if (!filter.status || filter.status === 'all') return all;
    return all.filter((j) => j.status === filter.status);
  },
};

const restSource: JobsDataSource = {
  // First page of the cursor feed; "Load more" pagination is a follow-up.
  list: async (filter) => {
    const params = new URLSearchParams({ limit: '50' });
    if (filter.status && filter.status !== 'all') params.set('status', filter.status);
    return (await apiFetch<JobsListResponse>(`jobs?${params}`)).items;
  },
};

export const jobsDataSource: JobsDataSource = env.useMocks ? mockSource : restSource;

/** Proxy URL for the streamed CSV export, honoring the active filter. */
export function jobsExportUrl(filter: JobsFilter): string {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== 'all') params.set('status', filter.status);
  const qs = params.toString();
  return `/api/proxy/jobs/export.csv${qs ? `?${qs}` : ''}`;
}
