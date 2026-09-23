'use client';

import { useParams } from 'next/navigation';
import { JobDetailScreen } from '@/features/jobs/components/JobDetailScreen';

/** `/jobs/[id]` — ADM-23's job page: the fare, where the money went, and the timeline. */
export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = params?.id ?? null;
  if (!jobId) return null;
  return <JobDetailScreen jobId={jobId} />;
}
