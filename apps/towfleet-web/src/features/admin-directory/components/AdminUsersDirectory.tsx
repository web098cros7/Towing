'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  FilterBar,
  SearchInput,
  Select,
  Tabs,
  type ColumnDef,
} from '@towing/web-ui';
import type {
  AdminDirectoryUser,
  AdminSuspensionRequest,
} from '@towing/api-contracts';
import { ApiError } from '@/lib/apiClient';
import { useAdminCan } from '@/components/admin/Can';
import {
  useAdminDirectoryUsers,
  useAdminSuspensionRequests,
} from '../api/adminDirectory.queries';
import {
  useApproveSuspensionRequest,
  useRejectSuspensionRequest,
  useSuspendUser,
} from '../api/adminDirectory.mutations';
import { SuspendSubjectDialog } from './SuspendSubjectDialog';

const STATUS_VARIANT: Record<AdminDirectoryUser['status'], 'success' | 'error' | 'neutral'> = {
  active: 'success',
  suspended: 'error',
  deleted: 'neutral',
};

const userColumns: ColumnDef<AdminDirectoryUser, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Customer',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.name ?? 'Unnamed customer'}</div>
        <div className="text-xs text-text-secondary">{row.original.mobile}</div>
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
    accessorKey: 'suspensionReason',
    header: 'Suspension',
    cell: ({ row }) => row.original.suspensionReason ?? <span className="text-text-tertiary">—</span>,
  },
  {
    accessorKey: 'createdAt',
    header: 'Joined',
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString('en-IN'),
  },
];

/**
 * W6's users directory (§9.4.4): search + status filter over `/v1/admin/users`,
 * the suspension requests inbox as its own tab, and the suspend flow.
 *
 * Support holds `user.suspend.request` and not `user.suspend`: their attempt is
 * refused by the server WITH a filed request (the 403 carries "a request was
 * filed"), and the dialog shows that message verbatim — the flow is honest
 * about who performs what rather than hiding the button.
 */
export function AdminUsersDirectory() {
  const can = useAdminCan();
  const canSuspend = can('user.suspend');

  const [tab, setTab] = useState<'users' | 'requests'>('users');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page] = useState(1);

  // §9.4's 300 ms debounce: one keystroke is not a search.
  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const usersQuery = useAdminDirectoryUsers({
    q: q || undefined,
    status: status || undefined,
    page,
    limit: 25,
  });
  const requestsQuery = useAdminSuspensionRequests('open');
  const suspendUser = useSuspendUser();
  const approveRequest = useApproveSuspensionRequest();
  const rejectRequest = useRejectSuspensionRequest();

  const [suspendTarget, setSuspendTarget] = useState<AdminDirectoryUser | null>(null);
  const [suspendError, setSuspendError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const columns = useMemo<ColumnDef<AdminDirectoryUser, unknown>[]>(
    () => [
      ...userColumns,
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/users/${row.original.id}`}
              data-testid="admin-user-open"
              className="text-sm font-medium text-brand underline-offset-2 hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              Open
            </Link>
            {row.original.status === 'active' && canSuspend ? (
              <Button
                variant="ghost"
                size="sm"
                data-testid="admin-user-suspend"
                onClick={(event) => {
                  event.stopPropagation();
                  setSuspendError(null);
                  setSuspendTarget(row.original);
                }}
              >
                Suspend
              </Button>
            ) : null}
            {row.original.status === 'active' && !canSuspend ? (
              <Button
                variant="ghost"
                size="sm"
                data-testid="admin-user-suspend-request"
                onClick={(event) => {
                  event.stopPropagation();
                  setSuspendError(null);
                  setSuspendTarget(row.original);
                }}
              >
                Request suspension
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [canSuspend],
  );

  const requestColumns: ColumnDef<AdminSuspensionRequest, unknown>[] = [
    {
      accessorKey: 'subjectType',
      header: 'Subject',
      cell: ({ row }) => (
        <div>
          <Badge variant="neutral">{row.original.subjectType}</Badge>
          <div className="mt-1 font-mono text-xs text-text-secondary">{row.original.subjectId}</div>
        </div>
      ),
    },
    { accessorKey: 'reason', header: 'Reason' },
    {
      accessorKey: 'createdAt',
      header: 'Filed',
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString('en-IN'),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) =>
        can('user.suspend') ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              data-testid="admin-request-approve"
              onClick={() =>
                void approveRequest
                  .mutateAsync({ requestId: row.original.id })
                  .catch((error: unknown) => setRequestError(String(error)))
              }
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="secondary"
              data-testid="admin-request-reject"
              onClick={() =>
                void rejectRequest
                  .mutateAsync({ requestId: row.original.id })
                  .catch((error: unknown) => setRequestError(String(error)))
              }
            >
              Reject
            </Button>
          </div>
        ) : (
          <span className="text-xs text-text-tertiary">Needs approval permission</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <Tabs
        aria-label="Directory sections"
        value={tab}
        onChange={(value) => setTab(value)}
        items={[
          { value: 'users', label: 'Customers' },
          { value: 'requests', label: 'Suspension requests' },
        ]}
      />

      {tab === 'users' ? (
        <>
          <FilterBar aria-label="Customer filters">
            <SearchInput
              value={searchInput}
              onValueChange={setSearchInput}
              placeholder="Name, mobile or id"
              data-testid="admin-users-search"
            />
            <Select
              aria-label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              data-testid="admin-users-status"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
          </FilterBar>

          <DataTable
            columns={columns}
            data={usersQuery.data?.items ?? []}
            isLoading={usersQuery.isLoading}
            isError={usersQuery.isError}
            onRetry={() => void usersQuery.refetch()}
            emptyTitle="No customers match"
            emptyDescription="Try a different name, number or id."
          />
        </>
      ) : (
        <>
          {requestError ? (
            <p role="alert" className="text-sm text-error">
              {requestError}
            </p>
          ) : null}
          <DataTable
            columns={requestColumns}
            data={requestsQuery.data?.items ?? []}
            isLoading={requestsQuery.isLoading}
            isError={requestsQuery.isError}
            onRetry={() => void requestsQuery.refetch()}
            emptyTitle="No open requests"
            emptyDescription="Suspension requests filed by support appear here for approval."
          />
        </>
      )}

      {suspendTarget ? (
        <SuspendSubjectDialog
          open
          onClose={() => setSuspendTarget(null)}
          title={`Suspend ${suspendTarget.name ?? suspendTarget.mobile}?`}
          description={
            canSuspend
              ? 'Searching bookings are cancelled fee-free. An active trip keeps running.'
              : 'Your role cannot perform suspensions — a request will be filed for approval.'
          }
          errorMessage={suspendError}
          onConfirm={async (reason) => {
            try {
              await suspendUser.mutateAsync({ userId: suspendTarget.id, reason });
              setSuspendTarget(null);
            } catch (error) {
              setSuspendError(
                error instanceof ApiError
                  ? error.message
                  : 'Suspension failed — nothing was changed.',
              );
            }
          }}
        />
      ) : null}
    </div>
  );
}
