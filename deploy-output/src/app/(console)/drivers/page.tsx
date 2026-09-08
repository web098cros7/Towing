'use client';

import { Badge, Button, DataTable, type ColumnDef } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useDrivers } from '@/features/drivers/api/drivers.queries';
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

  return (
    <div>
      <PageHeader
        title="Drivers"
        description="Drivers complete KYC in the TowPartner app; approval is always done centrally by platform admin."
        actions={
          <Button disabled title="Driver invitations go live with the backend (Phase 4)">
            Invite driver
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No drivers yet"
        emptyDescription="Invite drivers — they onboard through the TowPartner app and appear here with live KYC status."
      />
    </div>
  );
}
