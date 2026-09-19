'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, type ColumnDef, DataTable } from '@towing/web-ui';
import type { AdminAdminListItem, AdminSubRole } from '@towing/api-contracts';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { ApiError } from '@/lib/apiClient';
import { useAdminAdmins } from '@/features/admin-admins/api/adminAdmins.queries';
import { AdminCreateDialog } from '@/features/admin-admins/components/AdminCreateDialog';
import { AdminDetailDialog } from '@/features/admin-admins/components/AdminDetailDialog';

const ROLE_LABEL: Record<AdminSubRole, string> = {
  super_admin: 'Super admin',
  operations: 'Operations',
  support: 'Support',
  finance: 'Finance',
};

const ROLE_FILTERS: Array<AdminSubRole | 'all'> = ['all', 'super_admin', 'operations', 'support', 'finance'];

const columns: ColumnDef<AdminAdminListItem, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Admin',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.name}</div>
        <div className="text-xs text-text-secondary">{row.original.email}</div>
      </div>
    ),
  },
  {
    accessorKey: 'subRole',
    header: 'Role',
    cell: ({ row }) => <span className="text-sm">{ROLE_LABEL[row.original.subRole]}</span>,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <div className="flex gap-1">
        <Badge variant={row.original.status === 'active' ? 'success' : 'warning'}>
          {row.original.status === 'active' ? 'Active' : 'Suspended'}
        </Badge>
        {row.original.twofaEnabled && <Badge variant="neutral">2FA</Badge>}
      </div>
    ),
  },
  {
    accessorKey: 'lastLoginAt',
    header: 'Last sign-in',
    cell: ({ row }) =>
      row.original.lastLoginAt
        ? new Date(row.original.lastLoginAt).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        : 'Never',
  },
];

/**
 * W2's admin directory (spec §4.2 "Manage admins & roles").
 *
 * The whole page is super_admin-only — anything else gets the real 403
 * panel, not an empty table. Creation hands the temp password over once;
 * edits, deactivations and resets live in the detail dialog, each with the
 * reason the audit row requires.
 */
export default function AdminAdminsPage() {
  const [subRole, setSubRole] = useState<AdminSubRole | 'all'>('all');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const limit = 25;
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<AdminAdminListItem | null>(null);

  // 300 ms debounce: the directory is small, but every keystroke is still a
  // request, and server-side paging means each one re-queries from the top.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const { data, isLoading, isError, error, refetch } = useAdminAdmins({
    page,
    limit,
    ...(subRole === 'all' ? {} : { subRole }),
    ...(debouncedQ.trim().length >= 2 ? { q: debouncedQ.trim() } : {}),
  });

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / limit));

  // Same shrink-clamp as the finance queue (M0-F13): approving the last row
  // of page 2 must land back on page 1, not on an empty state with no pager.
  useEffect(() => {
    if (data !== undefined && page > pageCount) setPage(pageCount);
  }, [data, page, pageCount]);

  if (error instanceof ApiError && error.status === 403) {
    return (
      <div>
        <PageHeader title="Admins" description="Operators of this console." />
        <AdminForbidden resource="admin management" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Admins"
        description="Who can operate this console, and with which powers."
        actions={<Button onClick={() => setCreating(true)}>Create admin</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          aria-label="Search admins"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, email or mobile…"
          className="rounded-lg border border-border bg-surface0 px-3 py-1.5 text-sm"
        />
        {ROLE_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setSubRole(option);
              setPage(1);
            }}
            data-testid={`admins-filter-${option}`}
            className={
              subRole === option
                ? 'rounded-lg bg-brand-tint px-3 py-1.5 text-sm font-medium text-brand'
                : 'rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary'
            }
          >
            {option === 'all' ? 'All roles' : ROLE_LABEL[option]}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        onRowClick={(row) => setSelected(row)}
        emptyTitle="No admins found"
        emptyDescription="Nobody matches this filter. Only super admins ever reach this page."
        pagination={{ page, pageCount, onPageChange: setPage }}
      />

      {creating && <AdminCreateDialog onClose={() => setCreating(false)} />}
      {selected && <AdminDetailDialog admin={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
