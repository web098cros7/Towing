'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, DataTable, FilterBar, SearchInput, Select, type ColumnDef } from '@towing/web-ui';
import type { AdminFleetItem } from '@towing/api-contracts';
import { useAdminDirectoryFleets } from '../api/adminDirectory.queries';

const STATUS_VARIANT: Record<AdminFleetItem['status'], 'success' | 'error' | 'warning'> = {
  active: 'success',
  suspended: 'error',
  pending: 'warning',
};

const columns: ColumnDef<AdminFleetItem, unknown>[] = [
  {
    accessorKey: 'businessName',
    header: 'Fleet',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.businessName}</div>
        {row.original.gstin ? (
          <div className="text-xs text-text-secondary">{row.original.gstin}</div>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={STATUS_VARIANT[row.original.status]}>{row.original.status}</Badge>
    ),
  },
  {
    accessorKey: 'ownerName',
    header: 'Owner',
    cell: ({ row }) => (
      <div>
        <div>{row.original.ownerName ?? '—'}</div>
        <div className="text-xs text-text-secondary">{row.original.ownerMobile}</div>
      </div>
    ),
  },
  {
    id: 'drivers',
    header: 'Drivers',
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.driversCount}
        <span className="ml-1 text-xs text-text-secondary">
          ({row.original.onlineDriversCount} online)
        </span>
      </span>
    ),
  },
  {
    accessorKey: 'trucksCount',
    header: 'Trucks',
    cell: ({ row }) => <span className="tabular-nums">{row.original.trucksCount}</span>,
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => (
      <Link
        href={`/admin/fleets/${row.original.id}`}
        data-testid="admin-fleet-open"
        className="text-sm font-medium text-brand underline-offset-2 hover:underline"
      >
        Open
      </Link>
    ),
  },
];

/**
 * W6's fleets directory (§9.4.5) — with the dry-run counts the suspend
 * confirmation shows, right in the list.
 */
export function AdminFleetsDirectory() {
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  // §9.4's 300 ms debounce.
  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fleets = useAdminDirectoryFleets({
    q: q || undefined,
    status: (status || undefined) as never,
    page: 1,
    limit: 25,
  });

  return (
    <div className="space-y-4">
      <FilterBar aria-label="Fleet filters">
        <SearchInput
          value={searchInput}
          onValueChange={setSearchInput}
          placeholder="Business name, owner mobile or id"
          data-testid="admin-fleet-search"
        />
        <Select
          aria-label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          data-testid="admin-fleet-status-filter"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="suspended">Suspended</option>
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        data={fleets.data?.items ?? []}
        isLoading={fleets.isLoading}
        isError={fleets.isError}
        onRetry={() => void fleets.refetch()}
        emptyTitle="No fleets match"
        emptyDescription="Try a different business name or status."
      />
    </div>
  );
}
