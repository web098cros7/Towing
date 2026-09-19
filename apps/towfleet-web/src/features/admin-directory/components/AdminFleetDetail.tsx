'use client';

import { useState } from 'react';
import { Badge, Button, Card, DataTable, Tabs, type ColumnDef } from '@towing/web-ui';
import type { FleetDriverDto, TruckDto } from '@towing/api-contracts';
import { useAdminCan } from '@/components/admin/Can';
import { ApiError } from '@/lib/apiClient';
import { NotesPanel } from '@/features/admin-notes/components/NotesPanel';
import {
  useAdminDirectoryFleet,
  useAdminDirectoryFleetDrivers,
  useAdminDirectoryFleetEarnings,
  useAdminDirectoryFleetTrucks,
} from '../api/adminDirectory.queries';
import { useReactivateFleet, useSuspendFleet } from '../api/adminDirectory.mutations';
import { SuspendSubjectDialog } from './SuspendSubjectDialog';

const inr = (paise: number): string => `₹${(paise / 100).toLocaleString('en-IN')}`;

const truckColumns: ColumnDef<TruckDto, unknown>[] = [
  {
    accessorKey: 'plate',
    header: 'Truck',
    cell: ({ row }) => (
      <div>
        <div className="font-mono text-sm">{row.original.plate}</div>
        <div className="text-xs text-text-secondary">
          {row.original.type} · {row.original.capacityTons}t
        </div>
      </div>
    ),
  },
  { accessorKey: 'status', header: 'Status', cell: ({ row }) => <Badge variant="neutral">{row.original.status}</Badge> },
  {
    accessorKey: 'assignedDriverName',
    header: 'Assigned driver',
    cell: ({ row }) => row.original.assignedDriverName ?? <span className="text-text-tertiary">—</span>,
  },
  {
    accessorKey: 'lastPingAt',
    header: 'Last ping',
    cell: ({ row }) =>
      row.original.lastPingAt ? new Date(row.original.lastPingAt).toLocaleTimeString('en-IN') : '—',
  },
];

const fleetDriverColumns: ColumnDef<FleetDriverDto, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Driver',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.name}</div>
        <div className="text-xs text-text-secondary">{row.original.phone}</div>
      </div>
    ),
  },
  { accessorKey: 'kycStatus', header: 'KYC', cell: ({ row }) => <Badge variant="neutral">{row.original.kycStatus}</Badge> },
  {
    accessorKey: 'isOnline',
    header: 'Online',
    cell: ({ row }) => (row.original.isOnline ? '● Online' : 'Offline'),
  },
  {
    accessorKey: 'assignedTruckPlate',
    header: 'Truck',
    cell: ({ row }) => row.original.assignedTruckPlate ?? <span className="text-text-tertiary">—</span>,
  },
  { accessorKey: 'tripsTotal', header: 'Trips' },
  {
    accessorKey: 'monthNetPaise',
    header: 'Net this month',
    cell: ({ row }) => inr(row.original.monthNetPaise),
  },
];

/**
 * W6's fleet detail (§9.4.5): profile with the dry-run counts, the fleet's
 * trucks/drivers/earnings through the fleet console's own services, and A15's
 * suspend — behind a TYPED-NAME confirmation, because one click here can take
 * a whole fleet offline.
 */
export function AdminFleetDetail({ fleetId }: { fleetId: string }) {
  const can = useAdminCan();
  const canSuspend = can('fleet.suspend');
  const canSeeEarnings = can('finance.summary');

  const fleet = useAdminDirectoryFleet(fleetId);
  const [tab, setTab] = useState<'profile' | 'trucks' | 'drivers' | 'earnings' | 'notes'>('profile');
  const trucks = useAdminDirectoryFleetTrucks(fleetId, 1);
  const drivers = useAdminDirectoryFleetDrivers(fleetId, 1);
  const earnings = useAdminDirectoryFleetEarnings(canSeeEarnings ? fleetId : null);

  const suspend = useSuspendFleet();
  const reactivate = useReactivateFleet();
  const [suspending, setSuspending] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  if (fleet.isLoading) return <Card className="p-6">Loading fleet…</Card>;
  if (fleet.isError || !fleet.data) {
    return (
      <Card className="p-6 text-sm text-text-secondary" data-testid="admin-fleet-missing">
        This fleet could not be loaded.
      </Card>
    );
  }

  const row = fleet.data;
  const tabs = [
    { value: 'profile' as const, label: 'Profile' },
    { value: 'trucks' as const, label: 'Trucks' },
    { value: 'drivers' as const, label: 'Drivers' },
    ...(canSeeEarnings ? [{ value: 'earnings' as const, label: 'Earnings' }] : []),
    { value: 'notes' as const, label: 'Notes' },
  ];

  return (
    <div className="space-y-4" data-testid="admin-fleet-detail">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{row.businessName}</h1>
            <p className="text-sm text-text-secondary">
              {row.ownerName ?? '—'} · {row.ownerMobile}
              {row.gstin ? ` · GSTIN ${row.gstin}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={row.status === 'active' ? 'success' : row.status === 'suspended' ? 'error' : 'warning'}>
                {row.status}
              </Badge>
              <span className="text-sm text-text-secondary">
                {row.driversCount} drivers ({row.onlineDriversCount} online) · {row.trucksCount} trucks
              </span>
            </div>
            {row.suspensionReason ? (
              <p className="mt-2 text-sm text-error" data-testid="admin-fleet-suspension-reason">
                Suspended: {row.suspensionReason}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {row.status !== 'suspended' ? (
              <Button
                variant="destructive"
                data-testid="admin-fleet-suspend"
                onClick={() => {
                  setSuspendError(null);
                  setSuspending(true);
                }}
              >
                {canSuspend ? 'Suspend fleet' : 'Request suspension'}
              </Button>
            ) : canSuspend ? (
              <Button
                variant="secondary"
                data-testid="admin-fleet-reactivate"
                disabled={reactivate.isPending}
                onClick={() =>
                  void reactivate
                    .mutateAsync({ fleetId })
                    .catch((error: unknown) =>
                      setSuspendError(error instanceof ApiError ? error.message : 'Reactivate failed'),
                    )
                }
              >
                Reactivate
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Tabs aria-label="Fleet sections" value={tab} onChange={(value) => setTab(value)} items={tabs} />

      {tab === 'profile' ? (
        <Card className="grid grid-cols-2 gap-4 p-6 text-sm md:grid-cols-4">
          <div>
            <div className="text-text-secondary">Joined</div>
            <div>{new Date(row.createdAt).toLocaleDateString('en-IN')}</div>
          </div>
          <div>
            <div className="text-text-secondary">Fleet id</div>
            <div className="font-mono text-xs">{row.id}</div>
          </div>
          <div>
            <div className="text-text-secondary">Drivers that go offline on suspend</div>
            <div data-testid="admin-fleet-dry-run">{row.driversCount}</div>
          </div>
          <div>
            <div className="text-text-secondary">Suspended at</div>
            <div>{row.suspendedAt ? new Date(row.suspendedAt).toLocaleString('en-IN') : '—'}</div>
          </div>
        </Card>
      ) : null}

      {tab === 'trucks' ? (
        <DataTable
          columns={truckColumns}
          data={trucks.data?.items ?? []}
          isLoading={trucks.isLoading}
          isError={trucks.isError}
          onRetry={() => void trucks.refetch()}
          emptyTitle="No trucks"
          emptyDescription="This fleet has no registered trucks."
        />
      ) : null}

      {tab === 'drivers' ? (
        <DataTable
          columns={fleetDriverColumns}
          data={drivers.data?.items ?? []}
          isLoading={drivers.isLoading}
          isError={drivers.isError}
          onRetry={() => void drivers.refetch()}
          emptyTitle="No drivers"
          emptyDescription="This fleet has no drivers."
        />
      ) : null}

      {tab === 'earnings' && canSeeEarnings ? (
        <Card className="space-y-4 p-6" data-testid="admin-fleet-earnings">
          {earnings.isLoading ? (
            <p className="text-sm text-text-secondary">Loading…</p>
          ) : earnings.data ? (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div>
                  <div className="text-text-secondary">Wallet balance</div>
                  <div className="text-lg font-semibold">{inr(earnings.data.wallet.balancePaise)}</div>
                </div>
                <div>
                  <div className="text-text-secondary">Available</div>
                  <div className="text-lg font-semibold">{inr(earnings.data.wallet.availablePaise)}</div>
                </div>
                <div>
                  <div className="text-text-secondary">Jobs (period)</div>
                  <div className="text-lg font-semibold">{earnings.data.totals.jobs}</div>
                </div>
                <div>
                  <div className="text-text-secondary">Fleet share (period)</div>
                  <div className="text-lg font-semibold">{inr(earnings.data.totals.fleetSharePaise)}</div>
                </div>
              </div>
              <div className="text-xs text-text-secondary">
                Period {earnings.data.period.from} → {earnings.data.period.to}. Gross{' '}
                {inr(earnings.data.totals.grossPaise)}, commission {inr(earnings.data.totals.commissionPaise)}.
              </div>
            </>
          ) : (
            <p className="text-sm text-text-secondary">Earnings unavailable for this fleet.</p>
          )}
        </Card>
      ) : null}

      {tab === 'notes' ? <NotesPanel subjectType="fleet" subjectId={fleetId} /> : null}

      <SuspendSubjectDialog
        open={suspending}
        onClose={() => setSuspending(false)}
        title={`Suspend ${row.businessName}?`}
        description={`${row.driversCount} drivers (${row.onlineDriversCount} online) are affected. Their live offers are revoked and every jobless driver is taken offline.`}
        typedName={canSuspend ? row.businessName : undefined}
        errorMessage={suspendError}
        onConfirm={async (reason) => {
          try {
            await suspend.mutateAsync({ fleetId, reason });
            setSuspending(false);
          } catch (error) {
            setSuspendError(error instanceof ApiError ? error.message : 'Suspension failed.');
          }
        }}
      />
    </div>
  );
}
