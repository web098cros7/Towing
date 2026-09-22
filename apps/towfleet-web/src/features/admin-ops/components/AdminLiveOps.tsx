'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { AdminLiveBooking, AdminLiveDriver } from '@towing/api-contracts';
import {
  Badge,
  Card,
  CardContent,
  cn,
  ErrorState,
  RelativeTime,
  Skeleton,
  StatusChip,
} from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useAdminCan } from '@/components/admin/Can';
import { useAdminRealtime } from '@/features/admin-realtime/AdminRealtimeProvider';
import { adminOpsSubscribe } from '@/features/admin-realtime/lib/socket';
import { ageSeconds, presenceFor, presenceLabel } from '@/features/realtime/presence';
import { useAdminOpsLive } from '../api/adminOps.queries';
import { AdminLiveMap } from './AdminLiveMap';
import { AdminMapFilters, EMPTY_ADMIN_FILTERS, type AdminMapFilterState } from './AdminMapFilters';

/**
 * W4's live map page (§9.4.6) — `AdminLiveOps`.
 *
 * Data flows exactly as the guide designs it: the REST snapshot decides which
 * markers exist (and is refetched on every reconnect via the provider), the
 * socket stream moves them, and the zone filter is sent back through
 * `ops:subscribe` so the server only pushes the zones being watched. The side
 * panel is deliberately DETAILS-ONLY: cancel/reassign/dispute/suspend are W6/W8
 * endpoints that do not exist yet, and a rendered button that does nothing is
 * worse than one that ships with its action.
 */
export function AdminLiveOps(): React.ReactNode {
  const { mode } = useAdminRealtime();
  const [filters, setFilters] = useState<AdminMapFilterState>(EMPTY_ADMIN_FILTERS);
  const [selection, setSelection] = useState<{ driverId: string | null; bookingId: string | null }>(
    { driverId: null, bookingId: null },
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  // One tick a second drives presence ages and the stale filter without
  // refetching anything — the fleet map's discipline.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const query = useMemo(
    () => ({
      ...(filters.zoneId ? { zoneId: filters.zoneId } : {}),
      ...(filters.status !== 'all' ? { status: filters.status } : {}),
    }),
    [filters.zoneId, filters.status],
  );

  const live = useAdminOpsLive(query, true, mode);

  // Zone filter as a room join. Re-sent whenever it changes AND on every
  // (re)connect: a fresh socket is only in `admin:ops`, and forgetting this
  // would silently restart the full firehose the filter exists to stop.
  useEffect(() => {
    if (mode !== 'live') return;
    adminOpsSubscribe({ zoneIds: filters.zoneId ? [filters.zoneId] : [] });
  }, [mode, filters.zoneId]);

  const allDrivers = live.data?.drivers ?? [];
  const drivers = useMemo(() => {
    if (!filters.staleOnly) return allDrivers;
    return allDrivers.filter(
      (driver) => presenceFor(driver.at ? Date.parse(driver.at) : null, nowMs) !== 'live',
    );
  }, [allDrivers, filters.staleOnly, nowMs]);

  const bookings = useMemo(
    () =>
      (live.data?.bookings ?? []).filter(
        (booking) => filters.status === 'all' || booking.status === filters.status,
      ),
    [live.data, filters.status],
  );

  // Panels resolve against the FULL snapshot, not the filtered list, so
  // changing a filter cannot blank the thing the operator was reading.
  const selectedDriver =
    allDrivers.find((driver) => driver.driverId === selection.driverId) ?? null;
  const selectedBooking =
    (live.data?.bookings ?? []).find((booking) => booking.bookingId === selection.bookingId) ??
    null;

  return (
    <div>
      <PageHeader title="Live Ops" description="Every online driver and active job on one map." />

      {live.isError ? (
        <ErrorState onRetry={() => void live.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <AdminMapFilters value={filters} onChange={setFilters} zones={live.data?.zones ?? []} />

          {live.data?.degraded ? (
            <div>
              <Badge
                variant="warning"
                title="Redis unavailable — positions served from the database"
              >
                Last known positions
              </Badge>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <Card>
              <CardContent className="p-0">
                <div className="h-[560px]">
                  {live.isLoading || !live.data ? (
                    <Skeleton className="h-full w-full" />
                  ) : (
                    <AdminLiveMap
                      drivers={drivers}
                      bookings={bookings}
                      zones={live.data.zones}
                      selectedDriverId={selection.driverId}
                      selectedBookingId={selection.bookingId}
                      onSelect={setSelection}
                    />
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-4">
              {selectedDriver ? <DriverPanel driver={selectedDriver} nowMs={nowMs} /> : null}
              {selectedBooking ? <BookingPanel booking={selectedBooking} /> : null}

              <Card>
                <CardContent className="flex flex-col gap-0.5 p-3">
                  <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                    Drivers ({drivers.length})
                  </div>
                  {drivers.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-text-secondary">No drivers match.</p>
                  ) : (
                    drivers.map((driver) => (
                      <button
                        key={driver.driverId}
                        type="button"
                        data-testid="admin-rail-driver"
                        onClick={() => setSelection({ driverId: driver.driverId, bookingId: null })}
                        className={cn(
                          'flex items-center gap-2 rounded-input px-2 py-2 text-left text-sm hover:bg-surface1',
                          selection.driverId === driver.driverId && 'bg-brand-tint',
                        )}
                      >
                        <span className="flex-1 truncate">{driver.name ?? 'Unnamed driver'}</span>
                        <span className="text-xs text-text-tertiary">
                          {presenceLabel(
                            presenceFor(driver.at ? Date.parse(driver.at) : null, nowMs),
                          )}
                        </span>
                      </button>
                    ))
                  )}

                  <div className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                    Active jobs ({bookings.length})
                  </div>
                  {bookings.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-text-secondary">No active jobs match.</p>
                  ) : (
                    bookings.map((booking) => (
                      <button
                        key={booking.bookingId}
                        type="button"
                        data-testid="admin-rail-booking"
                        onClick={() =>
                          setSelection({ driverId: null, bookingId: booking.bookingId })
                        }
                        className={cn(
                          'flex items-center gap-2 rounded-input px-2 py-2 text-left text-sm hover:bg-surface1',
                          selection.bookingId === booking.bookingId && 'bg-brand-tint',
                        )}
                      >
                        <span className="flex-1 font-mono text-xs">
                          {booking.bookingId.slice(0, 8)}
                        </span>
                        <StatusChip status={booking.status} />
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DriverPanel({
  driver,
  nowMs,
}: {
  driver: AdminLiveDriver;
  nowMs: number;
}): React.ReactNode {
  const presence = presenceFor(driver.at ? Date.parse(driver.at) : null, nowMs);
  const age = ageSeconds(driver.at, nowMs);

  return (
    <Card data-testid="admin-driver-panel">
      <CardContent className="flex flex-col gap-1 p-4 text-sm">
        <div className="font-semibold">{driver.name ?? 'Unnamed driver'}</div>
        <div className="text-text-secondary">
          {presenceLabel(presence)}
          {age !== null ? ` · updated ${age}s ago` : ' · no position yet'}
        </div>
        <div className="text-text-secondary">
          Speed {driver.speedKph ?? '—'} km/h · heading {driver.headingDeg ?? '—'}°
        </div>
        <div className="text-xs text-text-tertiary">
          {driver.fromFallback ? 'Position from the database (degraded)' : 'Live position'}
        </div>
        {/* Details only: suspend lands with W6, cancel/reassign with W8. */}
      </CardContent>
    </Card>
  );
}

function BookingPanel({ booking }: { booking: AdminLiveBooking }): React.ReactNode {
  const can = useAdminCan();

  return (
    <Card data-testid="admin-booking-panel">
      <CardContent className="flex flex-col gap-1 p-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs">{booking.bookingId.slice(0, 8)}</span>
          <StatusChip status={booking.status} />
        </div>
        <div className="text-text-secondary">Service: {booking.serviceType}</div>
        <div className="text-text-secondary">
          Pickup {booking.pickup.lat.toFixed(4)}, {booking.pickup.lng.toFixed(4)}
        </div>
        {booking.drop ? (
          <div className="text-text-secondary">
            Drop {booking.drop.lat.toFixed(4)}, {booking.drop.lng.toFixed(4)}
          </div>
        ) : (
          <div className="text-text-tertiary">No destination on this service.</div>
        )}
        <div className="text-text-secondary">
          Created <RelativeTime at={booking.createdAt} />
        </div>
        {can('ops.dispatch.inspect') ? (
          <Link
            href={`/admin/ops/dispatch/${booking.bookingId}`}
            className="text-sm text-brand hover:underline"
          >
            Open dispatch inspector →
          </Link>
        ) : null}
        {/* Details only: cancel/reassign land with W8. */}
      </CardContent>
    </Card>
  );
}
