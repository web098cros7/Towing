'use client';

import Link from 'next/link';
import {
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerTitle,
  ErrorState,
  KpiCard,
  Skeleton,
} from '@towing/web-ui';
import { formatPaise } from '@/lib/money';
import { useDriverPerformance } from '../api/drivers.queries';
import { DriverShareSection } from './DriverShareSection';

const pct = (value: number | null): string => (value === null ? '\u2014' : `${value.toFixed(1)}%`);

/**
 * ADM-23: one driver's performance panel: the spec's "trips, rating,
 * earnings" for the fleet that employs them. Trips and earnings are the last
 * 30 days of THIS fleet's jobs; rating and the two rates are the standing
 * figures dispatch scores the driver on. Each recent job opens its job page.
 */
export function DriverPerformanceDrawer({
  driverId,
  onClose,
}: {
  driverId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError, refetch } = useDriverPerformance(driverId);

  return (
    <Drawer open={driverId !== null} onClose={onClose} labelledBy="driver-performance-title">
      <DrawerHeader>
        <DrawerTitle id="driver-performance-title">{data?.name ?? 'Driver'}</DrawerTitle>
        <p className="text-sm text-text-secondary">
          Performance over the last {data?.windowDays ?? 30} days on your jobs.
        </p>
      </DrawerHeader>
      <DrawerBody>
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : isError || !data ? (
          <ErrorState title="Could not load this driver" onRetry={() => void refetch()} />
        ) : (
          <div className="flex flex-col gap-5" data-testid="driver-performance">
            <div className="grid grid-cols-2 gap-3">
              <KpiCard label="Trips finished" value={String(data.trips.completed)} />
              <KpiCard
                label="Rating"
                value={data.rating === null ? '\u2014' : data.rating.toFixed(1)}
                hint={`${data.ratingsCount} ratings`}
              />
              <KpiCard label="Accepts offers" value={pct(data.acceptanceRatePct)} />
              <KpiCard label="Finishes jobs" value={pct(data.completionRatePct)} />
            </div>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Earnings (net of refunds)</h3>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Your fleet&apos;s share</span>
                <span className="tabular-nums font-semibold">
                  {formatPaise(data.earnings.fleetSharePaise)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">{data.name}&apos;s share</span>
                <span className="tabular-nums">{formatPaise(data.earnings.driverSharePaise)}</span>
              </div>
              <p className="mt-2 text-xs text-text-tertiary">
                {data.trips.cancelled} cancelled
                {data.trips.unable > 0 ? ` \u00b7 ${data.trips.unable} handed back unfinished` : ''}
              </p>
            </section>

            <DriverShareSection driverId={data.driverId} name={data.name} pay={data.pay} />

            <section>
              <h3 className="mb-2 text-sm font-semibold">Recent jobs</h3>
              {data.recentJobs.length === 0 ? (
                <p className="text-sm text-text-secondary">No jobs yet.</p>
              ) : (
                <ul className="flex flex-col gap-1" data-testid="driver-recent-jobs">
                  {data.recentJobs.map((job) => (
                    <li key={job.id} className="flex justify-between text-sm">
                      <Link href={`/jobs/${job.id}`} className="font-medium underline">
                        {job.code}
                      </Link>
                      <span className="tabular-nums text-text-secondary">
                        {formatPaise(job.grossPaise)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DrawerBody>
    </Drawer>
  );
}
