import type { DriverJobHistoryItem } from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import { serviceLabel } from '@/features/offers/serviceLabels';
import type { JobsDataSource } from './jobsDataSource';
import type { Job, JobFilter, JobStatus } from '../types';

/** §5.1's active states — what the "Active" tab means. */
const ACTIVE_STATUSES: readonly JobStatus[] = ['assigned', 'en_route', 'arrived', 'in_progress'];

/** The server's `status` query param for a given tab. */
function statusParam(filter: JobFilter): 'all' | 'completed' | 'cancelled' {
  if (filter === 'completed' || filter === 'cancelled') return filter;
  // 'all' and 'assigned' both ask for everything; 'assigned' narrows client-side
  // because the server has no single "active" bucket.
  return 'all';
}

/** "12 May, 10:30 AM" — the app's existing date shape, via Hermes-safe Intl. */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function toJob(item: DriverJobHistoryItem): Job {
  return {
    id: item.bookingId,
    vehicleName: serviceLabel(item),
    pickup: item.pickupAddress ?? 'Pickup',
    drop: item.dropAddress ?? 'At the spot',
    // `netPaise` is what the DRIVER earns — gross minus the platform's
    // commission. The card shows the driver's take, not the customer's fare.
    farePaise: item.earnings.netPaise,
    payment: item.paymentMethod,
    status: item.status,
    towTypeLabel: item.vehicleClass === 'flatbed' ? 'Flatbed' : 'Wheel-lift',
    distanceKm: item.distanceKm,
    dateTimeLabel: formatDateTime(item.completedAt ?? item.createdAt),
  };
}

export const jobsRestSource: JobsDataSource = {
  async getJobs(filter: JobFilter): Promise<Job[]> {
    const res = await apiFetch<{ items: DriverJobHistoryItem[]; nextCursor: string | null }>(
      `driver/job-history?limit=50&status=${statusParam(filter)}`,
    );
    const jobs = res.items.map(toJob);
    if (filter === 'assigned') {
      return jobs.filter((j) => ACTIVE_STATUSES.includes(j.status));
    }
    return jobs;
  },
};
