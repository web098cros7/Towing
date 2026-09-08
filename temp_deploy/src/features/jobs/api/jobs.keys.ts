import type { JobsFilter } from './jobsDataSource';

export const jobsKeys = {
  all: ['jobs'] as const,
  list: (filter: JobsFilter) => [...jobsKeys.all, 'list', filter] as const,
};
