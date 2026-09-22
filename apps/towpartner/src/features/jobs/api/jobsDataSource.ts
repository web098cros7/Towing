import { env } from '@/lib/env';
import type { Job, JobFilter } from '../types';
import { jobsMockSource } from './jobsMockSource';
import { jobsRestSource } from './jobsRestSource';

/**
 * Boundary between UI and backend. Selected by `env.useMocks` — the REST half
 * reads `driver/job-history` and maps it onto the same `Job` shape the mock
 * returns, so query hooks and components are unchanged.
 */
export interface JobsDataSource {
  getJobs(filter: JobFilter): Promise<Job[]>;
}

export const jobsDataSource: JobsDataSource = env.useMocks ? jobsMockSource : jobsRestSource;
