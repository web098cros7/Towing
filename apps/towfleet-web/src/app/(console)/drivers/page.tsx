'use client';

import { useMemo, useState } from 'react';
import { Badge, Button, DataTable, FilterBar, SearchInput, type ColumnDef } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useDrivers } from '@/features/drivers/api/drivers.queries';
import { DriverPerformanceDrawer } from '@/features/drivers/components/DriverPerformanceDrawer';
import { KYC_LABEL, type FleetDriver, type KycStatus } from '@/features/drivers/types';
import { formatPaise } from '@/lib/money';

const kycVariant: Record<KycStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  approved: 'success',
  pending: 'warning',
  incomplete: 'neutral',
  rejected: 'error',
  suspended: 'error',
};

const columns: ColumnDef<FleetDriver, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Driver',
    cell: ({ row }) => (
      <div>
        <div className="flex items-center gap-2 font-semibold">
          {row.original.name}
          {row.original.isOnline ? (
            <span className="size-2 rounded-full bg-success" title="Online" />
          ) : null}
        </div>
        <div className="text-xs text-text-secondary">{row.original.phone}</div>
      </div>
    ),
  },
  {
    accessorKey: 'kycStatus',
    header: 'KYC',
    cell: ({ row }) => (
      <Badge variant={kycVariant[row.original.kycStatus]}>{KYC_LABEL[row.original.kycStatus]}</Badge>
    ),
  },
  {
    accessorKey: 'assignedTruckPlate',
    header: 'Truck',
    cell: ({ row }) =>
      row.original.assignedTruckPlate ?? <span className="text-text-tertiary">Unassigned</span>,
  },
  {
    accessorKey: 'rating',
    header: 'Rating',
    cell: ({ row }) =>
      row.original.rating !== null ? (
        <span className="tabular-nums">★ {row.original.rating.toFixed(1)}</span>
      ) : (
        <span className="text-text-tertiary">—</span>
      ),
  },
  {
    accessorKey: 'tripsTotal',
    header: 'Trips',
    cell: ({ row }) => <span className="tabular-nums">{row.original.tripsTotal}</span>,
  },
  {
    accessorKey: 'monthNetPaise',
    header: 'Net this month',
    cell: ({ row }) => <span className="tabular-nums">{formatPaise(row.original.monthNetPaise)}</span>,
  },
];

export default function DriversPage() {
  const { data, isLoading, isError, refetch } = useDrivers();
  const [q, setQ] = useState('');
  const [openDriverId, setOpenDriverId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return data ?? [];
    return (data ?? []).filter((d) =>
      [d.name, d.phone, d.assignedTruckPlate ?? ''].join(' ').toLowerCase().includes(needle),
    );
  }, [data, q]);

  return (
    <div>
      <PageHeader
        title="Drivers"
        description="Drivers complete KYC in the MiTow Driver app; approval is always done centrally by platform admin."
        actions={
          <Button disabled title="Driver invitations go live with the backend (Phase 4)">
            Invite driver
          </Button>
        }
      />

      <FilterBar className="mb-4">
        <SearchInput
          value={q}
          onValueChange={setQ}
          placeholder="Name, phone or truck"
          className="w-72"
          data-testid="drivers-search"
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        // ADM-23: a row opens the driver's performance panel.
        onRowClick={(driver) => setOpenDriverId(driver.id)}
        emptyTitle={q ? 'No drivers match' : 'No drivers yet'}
        emptyDescription={
          q
            ? 'Clear the search to see the whole roster.'
            : 'Invite drivers — they onboard through the MiTow Driver app and appear here with live KYC status.'
        }
      />

      <DriverPerformanceDrawer driverId={openDriverId} onClose={() => setOpenDriverId(null)} />
    </div>
  );
}
