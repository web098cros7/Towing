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
} from '@towing/web-ui';
import type {
  AdminSupportTicket,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@towing/api-contracts';
import { PageHeader } from '@/components/PageHeader';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { ApiError } from '@/lib/apiClient';
import { useAdminSupportTickets } from '../api/adminSupport.queries';
import {
  SUPPORT_PRIORITY_LABEL,
  SUPPORT_STATUS_LABEL,
  SUPPORT_STATUS_TONE,
  slaState,
} from '../lib/supportSla';

const REQUESTER_LABEL: Record<AdminSupportTicket['requesterType'], string> = {
  user: 'Customer',
  driver: 'Driver',
  fleet: 'Fleet',
};

/**
 * The SLA cell — the queue's answer to "which of these is on fire?".
 *
 * `awaiting` vs `answered` is the only distinction ops act on: an unanswered
 * ticket older than its target is the one that gets looked at first, and a
 * ticket waiting on the requester is not ops' move at all.
 */
function SlaCell({ ticket }: { ticket: AdminSupportTicket }) {
  const state = slaState(ticket);

  if (state.kind === 'finished') return <span className="text-text-tertiary">—</span>;
  if (state.kind === 'answered') {
    return (
      <span className="text-xs text-text-secondary">answered in {state.hours.toFixed(1)}h</span>
    );
  }
  if (state.overdue) {
    return (
      <StatusChip
        status={`overdue ${Math.abs(state.dueInHours).toFixed(1)}h`}
        tone="error"
        data-testid="support-overdue"
      />
    );
  }
  return (
    <StatusChip status="awaiting first response" tone="warning" data-testid="support-awaiting" />
  );
}

const columns: ColumnDef<AdminSupportTicket, unknown>[] = [
  {
    id: 'requester',
    header: 'Requester',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.requesterName ?? 'Unknown'}</div>
        <div className="text-xs text-text-secondary">
          {REQUESTER_LABEL[row.original.requesterType]}
          {row.original.requesterMobile ? ` · ${row.original.requesterMobile}` : ''}
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'subject',
    header: 'Subject',
    cell: ({ row }) => (
      <div>
        <div>{row.original.subject}</div>
        <div className="font-mono text-xs text-text-secondary">{row.original.reference}</div>
      </div>
    ),
  },
  {
    id: 'category',
    header: 'Category',
    cell: ({ row }) => <span className="text-text-secondary">{row.original.category}</span>,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusChip
        status={SUPPORT_STATUS_LABEL[row.original.status]}
        tone={SUPPORT_STATUS_TONE[row.original.status]}
      />
    ),
  },
  {
    accessorKey: 'priority',
    header: 'Priority',
    cell: ({ row }) => (
      <span
        className={
          row.original.priority === 'urgent'
            ? 'font-semibold text-error-soft-fg'
            : 'text-text-secondary'
        }
      >
        {SUPPORT_PRIORITY_LABEL[row.original.priority]}
      </span>
    ),
  },
  { id: 'sla', header: 'First response', cell: ({ row }) => <SlaCell ticket={row.original} /> },
  {
    id: 'assigned',
    header: 'Assigned',
    cell: ({ row }) =>
      row.original.assignedAdminName ? (
        <span className="text-text-secondary">{row.original.assignedAdminName}</span>
      ) : (
        <span className="text-xs text-warning">unassigned</span>
      ),
  },
  {
    id: 'age',
    header: 'Opened',
    cell: ({ row }) => <RelativeTime at={row.original.createdAt} className="text-xs" />,
  },
];

/**
 * `/admin/support` — W15's queue (§9.4.12).
 *
 * The default tab is OPEN (everything that is not resolved/closed), because
 * somebody opening this page is answering tickets, not auditing them. Rows open
 * the thread, which is where the whole story lives — the requester, the public
 * replies, the internal notes and the status workflow are one screen.
 */
export function SupportQueue() {
  const router = useRouter();
  const { admin } = useAdminIdentity();
  const [statusTab, setStatusTab] = useState<'open' | SupportTicketStatus | 'all'>('open');
  const [priority, setPriority] = useState<SupportTicketPriority | ''>('');
  const [category, setCategory] = useState<SupportTicketCategory | ''>('');
  const [mineOnly, setMineOnly] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 25;

  const query = {
    page,
    limit,
    open: statusTab === 'open' ? true : undefined,
    status: statusTab !== 'open' && statusTab !== 'all' ? statusTab : undefined,
    priority: priority || undefined,
    category: category || undefined,
    assignedAdminId: mineOnly && admin ? admin.id : undefined,
  };

  const { data, isLoading, isError, error, refetch } = useAdminSupportTickets(query);

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / limit));
  useEffect(() => {
    if (data !== undefined && page > pageCount) setPage(pageCount);
  }, [data, page, pageCount]);

  if (error instanceof ApiError && error.status === 403) {
    return (
      <div>
        <PageHeader title="Support" description="Tickets from customers, drivers and fleets." />
        <AdminForbidden resource="the support console" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Support"
        description="Tickets raised from the apps. Reply in public, note in private — the requester only ever sees the public half."
      />

      <Tabs
        items={[
          { value: 'open', label: 'Open' },
          { value: 's:open', label: 'New' },
          { value: 's:in_progress', label: 'In progress' },
          { value: 's:pending_requester', label: 'Waiting' },
          { value: 's:resolved', label: 'Resolved' },
          { value: 's:closed', label: 'Closed' },
          { value: 'all', label: 'All' },
        ]}
        value={statusTab === 'open' || statusTab === 'all' ? statusTab : `s:${statusTab}`}
        onChange={(value) => {
          setStatusTab(
            value === 'open' || value === 'all' ? value : (value.slice(2) as SupportTicketStatus),
          );
          setPage(1);
        }}
        aria-label="Ticket status"
      />

      <FilterBar className="mb-4 mt-3">
        <Select
          className="w-44"
          value={priority}
          onChange={(event) => {
            setPriority(event.target.value as SupportTicketPriority | '');
            setPage(1);
          }}
          data-testid="support-priority-filter"
          aria-label="Priority filter"
        >
          <option value="">Any priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </Select>

        <Select
          className="w-44"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value as SupportTicketCategory | '');
            setPage(1);
          }}
          data-testid="support-category-filter"
          aria-label="Category filter"
        >
          <option value="">Any category</option>
          <option value="booking">Booking</option>
          <option value="payment">Payment</option>
          <option value="kyc">KYC</option>
          <option value="app">App</option>
          <option value="safety">Safety</option>
          <option value="other">Other</option>
        </Select>

        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(event) => {
              setMineOnly(event.target.checked);
              setPage(1);
            }}
            data-testid="support-mine-filter"
          />
          Assigned to me
        </label>
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No tickets here"
        emptyDescription="Nothing matches this tab and filter."
        pagination={{ page, pageCount, onPageChange: setPage }}
        onRowClick={(row) => router.push(`/admin/support/${row.id}`)}
      />
    </div>
  );
}
