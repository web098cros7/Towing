import type {
  DriverEarningsSummaryDto,
  DriverJobHistoryResponse,
  DriverProfile as DriverMe,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import { serviceLabel } from '@/features/offers/serviceLabels';
import type { DashboardDataSource } from './dashboardDataSource';
import type { DashboardData } from '../types';

/**
 * The dashboard against the real server.
 *
 * Three reads in parallel: the driver's own record (name + rating), today's
 * earnings totals (jobs + net paise), and the three most recent jobs for the
 * activity list. The greeting name is the FIRST WORD of `me.name` — a driver
 * who has not set a name gets 'Partner' rather than an empty greeting.
 */
export const dashboardRestSource: DashboardDataSource = {
  async getDashboard(): Promise<DashboardData> {
    const today = istToday();

    const [me, earnings, history] = await Promise.all([
      apiFetch<DriverMe>('driver/me'),
      apiFetch<DriverEarningsSummaryDto>(`driver/earnings?from=${today}&to=${today}`),
      apiFetch<DriverJobHistoryResponse>('driver/job-history?limit=3&status=all'),
    ]);

    return {
      driverName: firstName(me.name) ?? 'Partner',
      summary: {
        jobsCompleted: earnings.totals.jobs,
        earningsPaise: earnings.totals.netPaise,
        rating: me.rating,
      },
      recentActivity: history.items.map((item) => ({
        id: item.bookingId,
        vehicleName: serviceLabel(item),
        pickup: item.pickupAddress ?? 'Pickup',
        drop: item.dropAddress ?? 'At the spot',
        // The DRIVER's net, not the gross — the dashboard is the driver's own
        // view of what they earned, and the gross includes the platform's cut.
        farePaise: item.earnings.netPaise,
        status: item.status,
      })),
    };
  },
};

function firstName(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

/**
 * Today's IST calendar day, as the server's own filter expects it. The
 * backend filters on `(settled_at at time zone 'Asia/Kolkata')::date`, so a
 * UTC-derived date disagrees with it between midnight and 05:30 IST.
 */
function istToday(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
