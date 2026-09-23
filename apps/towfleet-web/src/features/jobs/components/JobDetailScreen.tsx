'use client';

import Link from 'next/link';
import type { JobActor, JobDetail } from '@towing/api-contracts';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Skeleton,
} from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { formatPaise } from '@/lib/money';
import { useJob } from '../api/jobs.queries';
import { JOB_STATUS_LABEL } from '../types';

const ACTOR_LABEL: Record<JobActor, string> = {
  customer: 'Customer',
  driver: 'Driver',
  fleet_owner: 'You',
  mitow: 'MiTow',
  system: 'Automatic',
};

const PAYMENT_LABEL: Record<NonNullable<JobDetail['paymentMethod']>, string> = {
  upi: 'UPI',
  card: 'Card',
  cash: 'Cash to the driver',
  wallet: 'MiTow wallet',
};

/** The fare lines worth a row: zero lines are left out so the card reads like a receipt. */
function fareLines(fare: JobDetail['fare']): Array<[string, number]> {
  const lines: Array<[string, number]> = [
    ['Base fare', fare.basePaise],
    ['Distance', fare.distancePaise],
    ['Night charge', fare.nightPaise],
    ['Highway charge', fare.highwayPaise],
    ['Accident recovery', fare.accidentPaise],
    ['Waiting time', fare.waitingPaise],
    ['Surge', fare.surgePaise],
    ['Coupon', -fare.discountPaise],
    ['Tax', fare.taxPaise],
  ];
  return lines.filter(([, value]) => value !== 0);
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  );
}

/**
 * ADM-23: one job, as a fleet owner needs it — "why did I earn this on that
 * job?" The list shows totals; this shows the fare line by line, where every
 * rupee went (read from what was actually credited, so it matches the
 * statement), and when each step happened.
 */
export function JobDetailScreen({ jobId }: { jobId: string }) {
  const { data: job, isLoading, isError, refetch } = useJob(jobId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4" data-testid="job-detail-loading">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div>
        <PageHeader title="Job" />
        <ErrorState
          title="This job could not be loaded"
          description="It may not belong to your fleet, or the connection dropped."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  const lines = fareLines(job.fare);

  return (
    <div data-testid="job-detail">
      <PageHeader
        eyebrow="Job"
        title={job.code}
        description={`${job.serviceType} · ${job.pickupArea}${job.dropArea ? ` → ${job.dropArea}` : ''}`}
        actions={
          <Link href="/jobs" className="text-sm text-text-secondary underline">
            All jobs
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Where the money went</CardTitle>
          </CardHeader>
          <CardContent data-testid="job-split">
            <Row label="Customer paid" value={formatPaise(job.fare.totalPaise)} strong />
            <Row
              label={`MiTow commission${job.commissionPct !== null ? ` (${job.commissionPct}%, band ${job.commissionBand})` : ''}`}
              value={`−${formatPaise(job.split.commissionPaise)}`}
            />
            {job.split.settled ? (
              <>
                <Row
                  label="Your fleet's share"
                  value={formatPaise(job.split.fleetSharePaise ?? 0)}
                  strong
                />
                <Row
                  label={`${job.driverName ?? 'Driver'}'s share`}
                  value={formatPaise(job.split.driverSharePaise ?? 0)}
                />
              </>
            ) : (
              <p className="mt-2 text-sm text-text-secondary">
                Not settled yet. The shares appear once the customer has paid.
              </p>
            )}
            {job.split.refundedPaise > 0 ? (
              <Row
                label="Taken back by a customer refund"
                value={`−${formatPaise(job.split.refundedPaise)}`}
              />
            ) : null}
            {job.paymentMethod ? (
              <Row label="Paid by" value={PAYMENT_LABEL[job.paymentMethod]} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>The fare</CardTitle>
          </CardHeader>
          <CardContent data-testid="job-fare">
            {lines.map(([label, value]) => (
              <Row
                key={label}
                label={label}
                value={value < 0 ? `−${formatPaise(-value)}` : formatPaise(value)}
              />
            ))}
            <div className="mt-1 border-t border-border pt-1">
              <Row label="Total" value={formatPaise(job.fare.totalPaise)} strong />
            </div>
            <Row label="Distance" value={`${job.distanceKm.toFixed(1)} km`} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What happened</CardTitle>
          </CardHeader>
          <CardContent>
            {job.timeline.length === 0 ? (
              <p className="text-sm text-text-secondary">No steps recorded yet.</p>
            ) : (
              <ol className="flex flex-col gap-2" data-testid="job-timeline">
                {job.timeline.map((entry, index) => (
                  <li
                    key={`${entry.status}-${index}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <Badge variant="neutral">{JOB_STATUS_LABEL[entry.status]}</Badge>
                      <span className="text-text-secondary">{ACTOR_LABEL[entry.actor]}</span>
                    </span>
                    <time className="tabular-nums text-text-secondary" dateTime={entry.at}>
                      {new Date(entry.at).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </li>
                ))}
              </ol>
            )}
            {job.cancellation ? (
              <div
                className="mt-3 rounded-md bg-surface1 p-3 text-sm"
                data-testid="job-cancellation"
              >
                Cancelled
                {job.cancellation.by ? ` by ${ACTOR_LABEL[job.cancellation.by].toLowerCase()}` : ''}
                {job.cancellation.reason ? `: “${job.cancellation.reason}”` : ''}.
                {job.cancellation.driverCompensationPaise > 0
                  ? ` The driver was compensated ${formatPaise(job.cancellation.driverCompensationPaise)}.`
                  : ''}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Who and where</CardTitle>
          </CardHeader>
          <CardContent>
            <Row label="Driver" value={job.driverName ?? '—'} />
            <Row label="Truck" value={job.truckPlate ?? '—'} />
            <Row label="Pickup" value={job.pickupAddress ?? job.pickupArea} />
            {job.dropAddress ? <Row label="Drop" value={job.dropAddress} /> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
