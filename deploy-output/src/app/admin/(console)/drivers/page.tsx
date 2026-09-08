'use client';

import { useState } from 'react';
import { Badge, type ColumnDef, DataTable } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useAdminPendingDrivers } from '@/features/admin-drivers/api/adminDrivers.queries';
import { DriverKycDrawer } from '@/features/admin-drivers/components/DriverKycDrawer';
import type { AdminPendingDriver } from '@/features/admin-drivers/types';

const VEHICLE_LABEL: Record<'wheel_lift' | 'flatbed', string> = {
  wheel_lift: 'Wheel-lift',
  flatbed: 'Flatbed',
};

const columns: ColumnDef<AdminPendingDriver, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Driver',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.name ?? 'Unnamed driver'}</div>
        <div className="text-xs text-text-secondary">{row.original.mobile}</div>
      </div>
    ),
  },
  {
    accessorKey: 'vehicleClass',
    header: 'Vehicle class',
    cell: ({ row }) =>
      row.original.vehicleClass ? (
        VEHICLE_LABEL[row.original.vehicleClass]
      ) : (
        <span className="text-text-tertiary">—</span>
      ),
  },
  {
    accessorKey: 'longDistanceEnabled',
    header: 'Long-distance',
    cell: ({ row }) =>
      row.original.longDistanceEnabled ? (
        <Badge variant="success">Opted in</Badge>
      ) : (
        <span className="text-text-tertiary">No</span>
      ),
  },
  {
    accessorKey: 'documents',
    header: 'Documents',
    cell: ({ row }) => {
      const total = row.original.documents.length;
      const rejected = row.original.documents.filter((d) => d.status === 'rejected').length;
      return (
        <span className="tabular-nums">
          {total}/5{rejected > 0 ? <span className="ml-1 text-error">({rejected} rejected)</span> : null}
        </span>
      );
    },
  },
  {
    accessorKey: 'kycSubmittedAt',
    header: 'Submitted',
    cell: ({ row }) =>
      row.original.kycSubmittedAt ? (
        new Date(row.original.kycSubmittedAt).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      ) : (
        <span className="text-text-tertiary">—</span>
      ),
  },
];

/**
 * The §3.1 KYC queue — the whole of Phase 11's admin console. Strictly the
 * drivers `GET /v1/admin/drivers/pending` returns (already scoped to
 * `kyc_status = 'pending'`); an `incomplete` driver never shows up here.
 */
export default function AdminDriversPage() {
  const { data, isLoading, isError, refetch } = useAdminPendingDrivers();
  const [selected, setSelected] = useState<AdminPendingDriver | null>(null);

  return (
    <div>
      <PageHeader
        title="KYC queue"
        description="Drivers who have submitted all documents and are awaiting review."
      />

      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        onRowClick={(row) => setSelected(row)}
        emptyTitle="Queue is empty"
        emptyDescription="Every submitted driver has been reviewed. New submissions will appear here."
      />

      <DriverKycDrawer driver={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
