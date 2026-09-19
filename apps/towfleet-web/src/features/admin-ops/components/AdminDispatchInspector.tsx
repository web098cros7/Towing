'use client';

import { useMemo } from 'react';
import type { AdminDispatchWaveCandidate, AdminDispatchWaveLog } from '@towing/api-contracts';
import {
  Badge,
  Card,
  CardContent,
  ErrorState,
  RelativeTime,
  Skeleton,
  StatusChip,
  humaniseStatus,
} from '@towing/web-ui';
import { useAdminRealtime } from '@/features/admin-realtime/AdminRealtimeProvider';
import { useAdminDispatchInspector } from '../api/adminOps.queries';
import { AdminLiveMap } from './AdminLiveMap';

/**
 * W5's dispatch inspector (§9.4.6) — "why did this driver win".
 *
 * Every number on this page comes from `dispatch_wave_logs`, written by the
 * wave runner after the offers went out; the mini-map draws each wave's radius
 * as a polygon ring around the pickup, because pixels would lie at other zooms.
 * A booking dispatched before the writer shipped shows an honest "no waves
 * recorded" — attempts alone cannot reconstruct what the engine never logged.
 */
export function AdminDispatchInspector({ bookingId }: { bookingId: string }): React.ReactNode {
  const { mode } = useAdminRealtime();
  const inspector = useAdminDispatchInspector(bookingId, true, mode);

  const rings = useMemo(() => {
    const booking = inspector.data?.booking;
    if (!booking) return [];
    return (inspector.data?.waves ?? []).map((wave) => ({
      lat: booking.pickup.lat,
      lng: booking.pickup.lng,
      radiusKm: wave.radiusKm,
      wave: wave.wave,
    }));
  }, [inspector.data]);

  if (inspector.isError) {
    return <ErrorState onRetry={() => void inspector.refetch()} />;
  }
  if (inspector.isLoading || !inspector.data) {
    return <Skeleton className="h-96 w-full" />;
  }

  const { booking, waves, attempts, weights, config } = inspector.data;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{booking.bookingId.slice(0, 8)}</span>
            <StatusChip status={booking.status} />
            {booking.longDistance ? <Badge variant="info">Long distance</Badge> : null}
            <span className="ml-auto text-text-secondary">
              {inspector.data.liveWave === null
                ? 'Search not started'
                : `Live: wave ${inspector.data.liveWave}`}
              {inspector.data.deadlineAt ? (
                <>
                  {' '}
                  · ends <RelativeTime at={inspector.data.deadlineAt} />
                </>
              ) : null}
            </span>
          </div>
          <div className="text-text-secondary">
            {booking.customerName ?? 'Customer'}
            {booking.customerMobile ? ` · ${booking.customerMobile}` : ''} · {booking.serviceType} ·{' '}
            {booking.vehicleClass}
          </div>
          <div className="text-text-secondary">
            Pickup{' '}
            {booking.pickupAddress ??
              `${booking.pickup.lat.toFixed(4)}, ${booking.pickup.lng.toFixed(4)}`}
            {booking.drop ? (
              <>
                {' '}
                → drop {booking.drop.lat.toFixed(4)}, {booking.drop.lng.toFixed(4)}
              </>
            ) : null}
          </div>
          <div className="text-xs text-text-tertiary">
            Weights — proximity {weights.proximity}% · rating {weights.rating}% · acceptance{' '}
            {weights.acceptance}% · completion {weights.completion}% · offers/wave{' '}
            {config.offersPerWave} · timeout {config.offerTimeoutSeconds}s
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardContent className="p-0">
            <div className="h-[320px]">
              <AdminLiveMap
                drivers={[]}
                bookings={[]}
                zones={[]}
                selectedDriverId={null}
                selectedBookingId={null}
                onSelect={() => undefined}
                rings={rings}
              />
            </div>
            <p className="px-4 py-2 text-xs text-text-tertiary">
              Search radii, drawn to scale
              {rings.length > 0
                ? ` — widest ${Math.max(...rings.map((ring) => ring.radiusKm))} km`
                : ''}
              .
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {waves.length === 0 ? (
            <Card>
              <CardContent className="p-4 text-sm text-text-secondary">
                No waves recorded for this booking — it was dispatched before the inspector started
                recording, or its search has not run yet.
              </CardContent>
            </Card>
          ) : (
            waves.map((wave) => <WaveCard key={wave.id} wave={wave} />)
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            Offers ({attempts.length})
          </div>
          {attempts.length === 0 ? (
            <p className="px-4 py-3 text-sm text-text-secondary">No offers have gone out yet.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="px-4 py-2 font-semibold">Driver</th>
                  <th className="px-4 py-2 font-semibold">Wave</th>
                  <th className="px-4 py-2 font-semibold">Outcome</th>
                  <th className="px-4 py-2 font-semibold">Offered</th>
                  <th className="px-4 py-2 font-semibold">Responded</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt, index) => (
                  <tr
                    key={`${attempt.driverId ?? 'unknown'}-${attempt.wave}-${index}`}
                    data-testid="admin-dispatch-attempt"
                    className="border-t border-border"
                  >
                    <td className="px-4 py-3">
                      {attempt.driverName ?? 'Unknown driver'}
                      {attempt.driverMobile ? (
                        <span className="ml-2 text-xs text-text-tertiary">
                          {attempt.driverMobile}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      Wave {attempt.wave} · {attempt.radiusKm} km
                    </td>
                    <td className="px-4 py-3">
                      <OutcomeBadge outcome={attempt.outcome} />
                    </td>
                    <td className="px-4 py-3">
                      <RelativeTime at={attempt.offeredAt} />
                    </td>
                    <td className="px-4 py-3">
                      {attempt.respondedAt ? <RelativeTime at={attempt.respondedAt} /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }): React.ReactNode {
  const variant: 'success' | 'brand' | 'warning' | 'neutral' =
    outcome === 'accepted'
      ? 'success'
      : outcome === 'offered'
        ? 'brand'
        : outcome === 'revoked'
          ? 'warning'
          : 'neutral';
  return <Badge variant={variant}>{humaniseStatus(outcome)}</Badge>;
}

function WaveCard({ wave }: { wave: AdminDispatchWaveLog }): React.ReactNode {
  const exclusions = Object.entries(wave.excluded);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Wave {wave.wave}</span>
          <Badge variant="neutral">{wave.radiusKm} km</Badge>
          {wave.degraded ? <Badge variant="warning">PostGIS fallback</Badge> : null}
          <span className="ml-auto text-xs text-text-tertiary">
            <RelativeTime at={wave.ranAt} /> · {wave.durationMs} ms
          </span>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-text-secondary">
          <span>{wave.considered} in range</span>
          <span>{wave.eligible} eligible</span>
          <span>{wave.offered} offered</span>
        </div>

        {wave.candidates.length === 0 ? (
          <p className="text-sm text-text-secondary">Nobody was in range.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {wave.candidates.map((candidate) => (
              <CandidateRow key={candidate.driverId} candidate={candidate} />
            ))}
          </div>
        )}

        {exclusions.length > 0 ? (
          <div className="flex flex-col gap-1">
            {exclusions.map(([reason, detail]) => (
              <details
                key={reason}
                data-testid="admin-dispatch-exclusion"
                className="text-xs text-text-secondary"
              >
                <summary className="cursor-pointer select-none">
                  {humaniseStatus(reason)} · {detail.count}
                </summary>
                <p className="mt-1 font-mono text-[11px] text-text-tertiary">
                  {detail.driverIds.length > 0
                    ? detail.driverIds.join(', ')
                    : 'No driver ids captured.'}
                </p>
              </details>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CandidateRow({ candidate }: { candidate: AdminDispatchWaveCandidate }): React.ReactNode {
  return (
    <div
      data-testid="admin-dispatch-candidate"
      className="rounded-input border border-border px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono">{candidate.driverId.slice(0, 8)}</span>
        <span className="text-text-tertiary">{(candidate.distanceM / 1000).toFixed(2)} km</span>
        <span className="ml-auto font-semibold">{candidate.score.toFixed(2)}</span>
        {candidate.offered ? (
          <Badge variant="brand">Offered</Badge>
        ) : (
          <Badge variant="neutral">Ranked</Badge>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-text-secondary sm:grid-cols-4">
        <TermBar term="proximity" label="Proximity" value={candidate.proximity} />
        <TermBar term="rating" label="Rating" value={candidate.rating} />
        <TermBar term="acceptance" label="Acceptance" value={candidate.acceptance} />
        <TermBar term="completion" label="Completion" value={candidate.completion} />
      </div>
    </div>
  );
}

function TermBar({
  term,
  label,
  value,
}: {
  term: string;
  label: string;
  value: number;
}): React.ReactNode {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-text-tertiary">{pct}%</span>
      </div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-surface1">
        <div
          data-testid="admin-dispatch-term"
          data-term={term}
          style={{ width: `${pct}%` }}
          className="h-full rounded-full bg-brand"
        />
      </div>
    </div>
  );
}
