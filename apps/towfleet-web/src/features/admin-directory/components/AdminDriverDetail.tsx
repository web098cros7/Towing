'use client';

import { useMemo, useState } from 'react';
import { Badge, Button, Card, DataTable, Tabs, type ColumnDef } from '@towing/web-ui';
import type { AdminDirectoryBooking } from '@towing/api-contracts';
import { useAdminCan } from '@/components/admin/Can';
import { ApiError } from '@/lib/apiClient';
import { NotesPanel } from '@/features/admin-notes/components/NotesPanel';
import {
  useAdminDirectoryDriver,
  useAdminDirectoryDriverBookings,
  useAdminDirectoryZones,
} from '../api/adminDirectory.queries';
import {
  useReactivateDriver,
  useSuspendDriver,
  useUpdateDriverZones,
} from '../api/adminDirectory.mutations';
import { SuspendSubjectDialog } from './SuspendSubjectDialog';

const bookingColumns: ColumnDef<AdminDirectoryBooking, unknown>[] = [
  {
    accessorKey: 'id',
    header: 'Booking',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.id.slice(0, 8)}</span>,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <Badge variant="neutral">{row.original.status}</Badge>,
  },
  { accessorKey: 'serviceType', header: 'Service' },
  {
    accessorKey: 'totalPaise',
    header: 'Total',
    cell: ({ row }) => `₹${(row.original.totalPaise / 100).toLocaleString('en-IN')}`,
  },
  {
    accessorKey: 'createdAt',
    header: 'When',
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleString('en-IN'),
  },
];

/**
 * W6's driver detail (§9.4.4): profile, the §6.10 zones editor, trips and
 * notes, plus A14's suspend/reactivate on the dedicated route.
 *
 * The zones editor is a full replacement: the checkbox set IS the driver's
 * blocked-zone list, and a same-set save is a server-side no-op (no second
 * audit row) — the save button disables while unchanged so the no-op is
 * visible rather than implied.
 */
export function AdminDriverDetail({ driverId }: { driverId: string }) {
  const can = useAdminCan();
  const canSuspend = can('user.suspend');
  const canEditZones = can('driver.capabilities');

  const driver = useAdminDirectoryDriver(driverId);
  const bookings = useAdminDirectoryDriverBookings(driverId, 1);
  const zones = useAdminDirectoryZones();
  const suspend = useSuspendDriver();
  const reactivate = useReactivateDriver();
  const updateZones = useUpdateDriverZones();

  const [tab, setTab] = useState<'profile' | 'zones' | 'trips' | 'notes'>('profile');
  const [suspending, setSuspending] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);
  const [selectedZones, setSelectedZones] = useState<string[] | null>(null);
  const [zonesSaved, setZonesSaved] = useState(false);
  const [zonesError, setZonesError] = useState<string | null>(null);

  const initialZones = useMemo(
    () => driver.data?.zoneRestrictions.map((zone) => zone.zoneId) ?? [],
    [driver.data],
  );
  const currentZones = selectedZones ?? initialZones;
  const zonesDirty = useMemo(
    () =>
      currentZones.length !== initialZones.length ||
      currentZones.some((zoneId) => !initialZones.includes(zoneId)),
    [currentZones, initialZones],
  );

  if (driver.isLoading) return <Card className="p-6">Loading driver…</Card>;
  if (driver.isError || !driver.data) {
    return (
      <Card className="p-6 text-sm text-text-secondary" data-testid="admin-driver-missing">
        This driver could not be loaded.
      </Card>
    );
  }

  const row = driver.data;

  return (
    <div className="space-y-4" data-testid="admin-driver-detail">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{row.name ?? 'Unnamed driver'}</h1>
            <p className="text-sm text-text-secondary">
              {row.mobile}
              {row.fleetName ? ` · ${row.fleetName}` : ' · Independent'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={row.kycStatus === 'approved' ? 'success' : 'warning'}>
                {row.kycStatus}
              </Badge>
              <Badge variant={row.isOnline ? 'success' : 'neutral'}>
                {row.isOnline ? 'Online' : 'Offline'}
              </Badge>
              <span className="text-text-secondary">
                {row.vehicleClass ?? 'No class'} · rating{' '}
                {row.rating === null ? '—' : row.rating.toFixed(1)} · {row.bookingsCount} trips
              </span>
            </div>
            {row.suspensionReason ? (
              <p className="mt-2 text-sm text-error" data-testid="admin-driver-suspension-reason">
                Suspended: {row.suspensionReason}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {row.kycStatus !== 'suspended' ? (
              <Button
                variant="destructive"
                data-testid="admin-driver-detail-suspend"
                onClick={() => {
                  setSuspendError(null);
                  setSuspending(true);
                }}
              >
                {canSuspend ? 'Suspend (A14)' : 'Request suspension'}
              </Button>
            ) : canSuspend ? (
              <Button
                variant="secondary"
                data-testid="admin-driver-reactivate"
                disabled={reactivate.isPending}
                onClick={() =>
                  void reactivate
                    .mutateAsync({ driverId })
                    .catch((error: unknown) =>
                      setSuspendError(
                        error instanceof ApiError ? error.message : 'Reactivate failed',
                      ),
                    )
                }
              >
                Reactivate
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Tabs
        aria-label="Driver sections"
        value={tab}
        onChange={(value) => setTab(value)}
        items={[
          { value: 'profile', label: 'Profile' },
          { value: 'zones', label: 'Zones' },
          { value: 'trips', label: 'Trips' },
          { value: 'notes', label: 'Notes' },
        ]}
      />

      {tab === 'profile' ? (
        <Card className="grid grid-cols-2 gap-4 p-6 text-sm md:grid-cols-4">
          <div>
            <div className="text-text-secondary">Current zone</div>
            <div>{row.zoneName ?? '—'}</div>
          </div>
          <div>
            <div className="text-text-secondary">Long-distance</div>
            <div>{row.longDistanceEnabled ? 'Opted in' : 'No'}</div>
          </div>
          <div>
            <div className="text-text-secondary">Last ping</div>
            <div>{row.lastPingAt ? new Date(row.lastPingAt).toLocaleTimeString('en-IN') : '—'}</div>
          </div>
          <div>
            <div className="text-text-secondary">Suspended shelf</div>
            <div>{row.suspensionPending ? 'Pending (finishes live job)' : 'None'}</div>
          </div>
        </Card>
      ) : null}

      {tab === 'zones' ? (
        <Card className="space-y-4 p-6" data-testid="admin-driver-zones">
          <div>
            <h2 className="font-semibold">Zone restrictions (§6.10)</h2>
            <p className="text-sm text-text-secondary">
              A checked zone BLOCKS this driver from dispatch there. No boxes checked means the
              driver may work everywhere.
            </p>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            {(zones.data?.items ?? []).map((zone) => {
              const checked = currentZones.includes(zone.id);
              return (
                <label key={zone.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!canEditZones}
                    data-testid={`admin-zone-checkbox-${zone.id}`}
                    onChange={() => {
                      setZonesSaved(false);
                      setSelectedZones(
                        checked
                          ? currentZones.filter((zoneId) => zoneId !== zone.id)
                          : [...currentZones, zone.id],
                      );
                    }}
                  />
                  <span>
                    {zone.name}
                    {zone.isActive ? '' : ' (inactive)'}
                  </span>
                </label>
              );
            })}
          </div>

          {zonesError ? (
            <p role="alert" className="text-sm text-error">
              {zonesError}
            </p>
          ) : null}

          {canEditZones ? (
            <div className="flex items-center gap-3">
              <Button
                data-testid="admin-zones-save"
                disabled={!zonesDirty || updateZones.isPending}
                onClick={() =>
                  void updateZones
                    .mutateAsync({ driverId, zoneIds: currentZones })
                    .then((result) => {
                      setSelectedZones(result.zoneRestrictions.map((zone) => zone.zoneId));
                      setZonesSaved(true);
                      setZonesError(null);
                    })
                    .catch((error: unknown) =>
                      setZonesError(
                        error instanceof ApiError ? error.message : 'Saving zones failed.',
                      ),
                    )
                }
              >
                Save zones
              </Button>
              {zonesSaved && !zonesDirty ? (
                <span className="text-sm text-success" data-testid="admin-zones-saved">
                  Saved
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-text-tertiary">Your role cannot edit zone restrictions.</p>
          )}
        </Card>
      ) : null}

      {tab === 'trips' ? (
        <DataTable
          columns={bookingColumns}
          data={bookings.data?.items ?? []}
          isLoading={bookings.isLoading}
          isError={bookings.isError}
          onRetry={() => void bookings.refetch()}
          emptyTitle="No trips yet"
          emptyDescription="This driver has not completed a tow."
        />
      ) : null}

      {tab === 'notes' ? <NotesPanel subjectType="driver" subjectId={driverId} /> : null}

      <SuspendSubjectDialog
        open={suspending}
        onClose={() => setSuspending(false)}
        title={`Suspend ${row.name ?? row.mobile}?`}
        description={
          canSuspend
            ? 'A14: with a live job the suspension is shelved until it ends; otherwise it applies at once.'
            : 'Your role cannot perform suspensions — a request will be filed for approval.'
        }
        errorMessage={suspendError}
        onConfirm={async (reason) => {
          try {
            await suspend.mutateAsync({ driverId, body: { reason } });
            setSuspending(false);
          } catch (error) {
            setSuspendError(error instanceof ApiError ? error.message : 'Suspension failed.');
          }
        }}
      />
    </div>
  );
}
