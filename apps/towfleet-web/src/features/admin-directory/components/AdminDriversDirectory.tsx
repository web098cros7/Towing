'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, DataTable, FilterBar, SearchInput, Select, type ColumnDef } from '@towing/web-ui';
import type { AdminDriverDirectoryItem } from '@towing/api-contracts';
import { useAdminDirectoryDrivers } from '../api/adminDirectory.queries';

const KYC_VARIANT: Record<
  AdminDriverDirectoryItem['kycStatus'],
  'success' | 'warning' | 'error' | 'neutral'
> = {
  approved: 'success',
  pending: 'warning',
  incomplete: 'neutral',
  rejected: 'error',
  suspended: 'error',
};

const columns: ColumnDef<AdminDriverDirectoryItem, unknown>[] = [
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
    accessorKey: 'kycStatus',
    header: 'KYC',
    cell: ({ row }) => (
      <Badge variant={KYC_VARIANT[row.original.kycStatus]}>{row.original.kycStatus}</Badge>
    ),
  },
  {
    accessorKey: 'isOnline',
    header: 'Online',
    cell: ({ row }) =>
      row.original.isOnline ? (
        <span className="inline-flex items-center gap-1 text-success">● Online</span>
      ) : (
        <span className="text-text-tertiary">Offline</span>
      ),
  },
  {
    accessorKey: 'zoneName',
    header: 'Zone',
    cell: ({ row }) => row.original.zoneName ?? <span className="text-text-tertiary">—</span>,
  },
  {
    accessorKey: 'fleetName',
    header: 'Fleet',
    cell: ({ row }) =>
      row.original.fleetName ?? <span className="text-text-tertiary">Independent</span>,
  },
  {
    accessorKey: 'vehicleClass',
    header: 'Class',
    cell: ({ row }) => row.original.vehicleClass ?? <span className="text-text-tertiary">—</span>,
  },
  {
    accessorKey: 'rating',
    header: 'Rating',
    cell: ({ row }) => (row.original.rating === null ? '—' : row.original.rating.toFixed(1)),
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => (
      <Link
        href={`/admin/drivers/list/${row.original.id}`}
        data-testid="admin-driver-open"
        className="text-sm font-medium text-brand underline-offset-2 hover:underline"
      >
        Open
      </Link>
    ),
  },
];

/**
 * W6's drivers directory (§9.4.4): the §3.2 facts an operator filters by.
 * The KYC QUEUE stays at `/admin/drivers` — this list is the searchable
 * directory, not the review flow.
 */
export function AdminDriversDirectory() {
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [kycStatus, setKycStatus] = useState('');
  const [online, setOnline] = useState('');

  // §9.4's 300 ms debounce: one keystroke is not a search.
  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const drivers = useAdminDirectoryDrivers({
    q: q || undefined,
    kycStatus: (kycStatus || undefined) as never,
    online: online === '' ? undefined : online === 'true',
    page: 1,
    limit: 25,
  });

  return (
    <div className="space-y-4">
      <FilterBar aria-label="Driver filters">
        <SearchInput
          value={searchInput}
          onValueChange={setSearchInput}
          placeholder="Name, mobile or id"
          data-testid="admin-driver-search"
        />
        <Select
          aria-label="KYC status"
          value={kycStatus}
          onChange={(event) => setKycStatus(event.target.value)}
          data-testid="admin-driver-kyc-filter"
        >
          <option value="">All KYC statuses</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="incomplete">Incomplete</option>
          <option value="rejected">Rejected</option>
          <option value="suspended">Suspended</option>
        </Select>
        <Select
          aria-label="Online"
          value={online}
          onChange={(event) => setOnline(event.target.value)}
          data-testid="admin-driver-online-filter"
        >
          <option value="">Online and offline</option>
          <option value="true">Online only</option>
          <option value="false">Offline only</option>
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        data={drivers.data?.items ?? []}
        isLoading={drivers.isLoading}
        isError={drivers.isError}
        onRetry={() => void drivers.refetch()}
        emptyTitle="No drivers match"
        emptyDescription="Try a different name, number or filter."
      />
    </div>
  );
}
