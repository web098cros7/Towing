import { useQuery } from '@tanstack/react-query';
import { jobsKeys } from './jobs.keys';
import { jobsDataSource, type JobsFilter } from './jobsDataSource';

export function useJobs(filter: JobsFilter) {
  return useQuery({
    queryKey: jobsKeys.list(filter),
    queryFn: () => jobsDataSource.list(filter),
  });
}
