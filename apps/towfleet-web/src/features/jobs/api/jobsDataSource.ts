import type { JobDetail, JobsListResponse } from '@towing/api-contracts';
import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { resolveMock } from '@/lib/mockUtils';
import { jobDetailMock, jobsMock } from '../mocks/jobs.mock';
import type { Job, JobStatus } from '../types';

export type JobsFilter = {
  status?: JobStatus | 'all';
};

export interface JobsDataSource {
  list(filter: JobsFilter): Promise<Job[]>;
  /** ADM-23: one job with its timeline, fare lines and the ledger split. */
  detail(id: string): Promise<JobDetail>;
}

const mockSource: JobsDataSource = {
  list: async (filter) => {
    const all = await resolveMock(env.mockJobsState, jobsMock, []);
    if (!filter.status || filter.status === 'all') return all;
    return all.filter((j) => j.status === filter.status);
  },
  detail: async (id) => {
    await resolveMock(env.mockJobsState, null, null);
    const job = jobsMock.find((row) => row.id === id);
    if (!job) throw new Error('Job not found');
    return jobDetailMock(job);
  },
};

const restSource: JobsDataSource = {
  // First page of the cursor feed; "Load more" pagination is a follow-up.
  list: async (filter) => {
    const params = new URLSearchParams({ limit: '50' });
    if (filter.status && filter.status !== 'all') params.set('status', filter.status);
    return (await apiFetch<JobsListResponse>(`jobs?${params}`)).items;
  },
  detail: (id) => apiFetch<JobDetail>(`jobs/${encodeURIComponent(id)}`),
};

export const jobsDataSource: JobsDataSource = env.useMocks ? mockSource : restSource;

/** Proxy URL for the streamed CSV export, honoring the active filter. */
export function jobsExportUrl(filter: JobsFilter): string {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== 'all') params.set('status', filter.status);
  const qs = params.toString();
  return `/api/proxy/jobs/export.csv${qs ? `?${qs}` : ''}`;
}
