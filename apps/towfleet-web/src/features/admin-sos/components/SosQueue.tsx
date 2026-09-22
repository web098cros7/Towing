'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  type ColumnDef,
  DataTable,
  FilterBar,
  RelativeTime,
  Select,
  StatusChip,
  Tabs,
  type StatusTone,
} from '@towing/web-ui';
import type { AdminSosAlert, SosStatus, SosSubjectType } from '@towing/api-contracts';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { ApiError } from '@/lib/apiClient';
import { useAdminSos } from '../api/adminSos.queries';

const STATUS_TONE: Record<SosStatus, StatusTone> = {
  triggered: 'error',
  acknowledged: 'warning',
  resolved: 'success',
  cancelled: 'neutral',
};

const SOURCE_LABEL: Record<AdminSosAlert['source'], string> = {
  app: 'App',
  ops: 'Phone call (ops)',
  sms_fallback: 'SMS fallback',
};

const columns: ColumnDef<AdminSosAlert, unknown>[] = [
  {
    accessorKey: 'subjectName',
    header: 'Subject',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.subjectName ?? 'Unknown'}</div>
        <div className="text-xs text-text-secondary">
          {row.original.subjectType === 'user' ? 'Customer' : 'Driver'}
          {row.original.subjectMobile ? ` · ${row.original.subjectMobile}` : ''}
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusChip status={row.original.status} tone={STATUS_TONE[row.original.status]} />
    ),
  },
  {
    id: 'raised',
    header: 'Raised',
    cell: ({ row }) => (
      <div>
        <RelativeTime at={row.original.createdAt} className="text-xs" />
        {row.original.ackSeconds !== null ? (
          <div className="text-xs text-text-secondary">acked in {row.original.ackSeconds}s</div>
        ) : (
          <div className="text-xs text-warning">no ack yet</div>
        )}
      </div>
    ),
  },
  {
    id: 'source',
    header: 'Source',
    cell: ({ row }) => (
      <span className="text-text-secondary">{SOURCE_LABEL[row.original.source]}</span>
    ),
  },
  {
    id: 'booking',
    header: 'Booking',
    cell: ({ row }) =>
      row.original.bookingCode ? (
        <span className="font-mono text-xs">{row.original.bookingCode}</span>
      ) : (
        <span className="text-text-tertiary">—</span>
      ),
  },
  {
    id: 'resolution',
    header: 'Resolution',
    cell: ({ row }) =>
      row.original.resolution ? (
        <span className="text-text-secondary">{row.original.resolution}</span>
      ) : (
        <span className="text-text-tertiary">—</span>
      ),
  },
];

/**
 * `/admin/sos` — W14's queue.
 *
 * The default tab is OPEN (triggered + acknowledged): somebody opening this
 * page is answering a page, not auditing incidents. Rows open the detail page,
 * which is where the incident's whole life lives — the timeline, the contact
 * snapshot and the workflow actions are all one screen, because during an
 * incident "which tab was that in" is a question nobody should have to ask.
 */
export function SosQueue() {
  const router = useRouter();
  const [statusTab, setStatusTab] = useState<'open' | SosStatus | 'all'>('open');
  const [subjectType, setSubjectType] = useState<SosSubjectType | ''>('');
  const [page, setPage] = useState(1);
  const limit = 25;

  const query = {
    page,
    limit,
    open: statusTab === 'open' ? true : undefined,
    status: statusTab !== 'open' && statusTab !== 'all' ? statusTab : undefined,
    subjectType: subjectType || undefined,
  };

  const { data, isLoading, isError, error, refetch } = useAdminSos(query);

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / limit));
  useEffect(() => {
    if (data !== undefined && page > pageCount) setPage(pageCount);
  }, [data, page, pageCount]);

  if (error instanceof ApiError && error.status === 403) {
    return (
      <div>
        <PageHeader title="SOS" description="Incidents in progress." />
        <AdminForbidden resource="the SOS console" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="SOS"
        description="Every alert raised from the apps or from a phone call. Acknowledge first, then contact, then resolve — the timeline keeps the record."
      />

      <Tabs
        items={[
          { value: 'open', label: 'Open' },
          { value: 'triggered', label: 'Triggered' },
          { value: 'acknowledged', label: 'Acknowledged' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'cancelled', label: 'Cancelled' },
          { value: 'all', label: 'All' },
        ]}
        value={statusTab}
        onChange={(value) => {
          setStatusTab(value as 'open' | SosStatus | 'all');
          setPage(1);
        }}
        aria-label="Alert status"
      />

      <FilterBar className="mb-4 mt-3">
        <Select
          className="w-48"
          value={subjectType}
          onChange={(event) => {
            setSubjectType(event.target.value as SosSubjectType | '');
            setPage(1);
          }}
          data-testid="sos-subject-filter"
          aria-label="Subject type filter"
        >
          <option value="">Customers + drivers</option>
          <option value="user">Customers</option>
          <option value="driver">Drivers</option>
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No alerts here"
        emptyDescription="Nothing matches this tab and filter."
        pagination={{ page, pageCount, onPageChange: setPage }}
        onRowClick={(row) => router.push(`/admin/sos/${row.id}`)}
      />
    </div>
  );
}
