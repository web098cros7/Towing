'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, type ColumnDef, DataTable } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { ApiError } from '@/lib/apiClient';
import {
  ADMIN_KYC_PAGE_SIZE,
  useAdminPendingDrivers,
} from '@/features/admin-drivers/api/adminDrivers.queries';
import { BulkDecisionDialog } from '@/features/admin-drivers/components/BulkDecisionDialog';
import { DriverKycDrawer } from '@/features/admin-drivers/components/DriverKycDrawer';
import type { AdminPendingDriver, KycBulkDecision } from '@/features/admin-drivers/types';

const VEHICLE_LABEL: Record<'wheel_lift' | 'flatbed', string> = {
  wheel_lift: 'Wheel-lift',
  flatbed: 'Flatbed',
};

/** The contract caps a bulk run at 50; the UI caps the SELECTION at the same number. */
const BULK_CAP = 50;

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
    accessorKey: 'lastKnownLocation',
    header: 'Last seen',
    cell: ({ row }) =>
      row.original.lastKnownLocation ? (
        <span className="text-xs text-text-secondary tabular-nums">
          {row.original.lastKnownLocation.lat.toFixed(3)}, {row.original.lastKnownLocation.lng.toFixed(3)}
        </span>
      ) : (
        <span className="text-text-tertiary">Never pinged</span>
      ),
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
 * The §3.1 KYC queue — the whole of Phase 11's admin console, finished by W7:
 * paged server-side, selectable for bulk approve/reject, and the row's detail
 * lives in the drawer.
 *
 * Strictly the drivers `GET /v1/admin/drivers/pending` returns (already scoped
 * to `kyc_status = 'pending'`); an `incomplete` driver never shows up here.
 */
export default function AdminDriversPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useAdminPendingDrivers(page);

  // A19: page state holds only the id — the drawer derives a LIVE row from
  // the queue query, so refetches, decisions and capability toggles reach it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * A suspension takes the row out of the queue, and the drawer stays open on
   * purpose: it becomes the undo. `pinnedId` is that one exception to "a row
   * that leaves the queue closes the drawer".
   */
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const selectedExists = useMemo(
    () =>
      selectedId === null
        ? false
        : selectedId === pinnedId || (data?.items ?? []).some((row) => row.id === selectedId),
    [data, selectedId, pinnedId],
  );

  /**
   * The selection is a MAP OF ROWS, and it deliberately survives paging — a
   * reviewer clearing a backlog selects a few from page 1, pages on, selects a
   * few more, and decides once. The row objects are kept (not just ids)
   * because a bulk run must name every driver it is about to decide, including
   * the ones no longer on screen.
   */
  const [selected, setSelected] = useState<Map<string, AdminPendingDriver>>(new Map());
  const [bulkDecision, setBulkDecision] = useState<KycBulkDecision | null>(null);
  const [capNotice, setCapNotice] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    const row = (data?.items ?? []).find((item) => item.id === id);
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(id)) next.delete(id);
      else if (row) next.set(id, row);
      return next;
    });
    setCapNotice(null);
  }, [data]);

  const toggleAll = useCallback(
    (ids: string[]) => {
      const rows = data?.items ?? [];
      setSelected((previous) => {
        if (ids.length === 0) return new Map();
        const next = new Map(previous);
        for (const id of ids) {
          if (next.size >= BULK_CAP && !next.has(id)) continue;
          const row = rows.find((item) => item.id === id);
          if (row) next.set(id, row);
        }
        return next;
      });
      setCapNotice(null);
    },
    [data],
  );

  // Drop a selection whose row left the queue (decided elsewhere): the drawer
  // already unmounts, but keeping the id would reopen it if the row ever
  // reappears on a later refetch.
  useEffect(() => {
    if (selectedId !== null && !selectedExists) setSelectedId(null);
  }, [selectedId, selectedExists]);

  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
  const selectedDrivers = useMemo(() => [...selected.values()], [selected]);

  const requestBulk = (decision: KycBulkDecision) => {
    if (selected.size === 0) return;
    if (selected.size > BULK_CAP) {
      setCapNotice(`Pick at most ${BULK_CAP} drivers at a time.`);
      return;
    }
    setBulkDecision(decision);
  };

  // A7: a valid session without the queue's sub-role is refused, not broken.
  if (error instanceof ApiError && error.status === 403) {
    return (
      <div>
        <PageHeader
          title="KYC queue"
          description="Drivers who have submitted all documents and are awaiting review."
        />
        <AdminForbidden resource="the verification queue" />
      </div>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="KYC queue"
        description="Drivers who have submitted all documents and are awaiting review."
      />

      {selected.size > 0 ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface1 px-4 py-2"
          data-testid="kyc-bulk-bar"
        >
          <span className="text-sm font-medium">{selected.size} selected</span>
          <button
            type="button"
            className="text-xs text-text-secondary underline"
            onClick={() => setSelected(new Map())}
            data-testid="kyc-bulk-clear"
          >
            Clear selection
          </button>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={() => requestBulk('reject')}
              data-testid="kyc-bulk-reject"
            >
              Reject selected
            </button>
            <button
              type="button"
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => requestBulk('approve')}
              data-testid="kyc-bulk-approve"
            >
              Approve selected
            </button>
          </div>
          {capNotice ? (
            <p className="w-full text-xs text-error" data-testid="kyc-bulk-cap">
              {capNotice}
            </p>
          ) : null}
        </div>
      ) : (
        // The list is longer than a page now; without paging the operator has no
        // idea how much work is behind the one they can see.
        data ? (
          <p className="text-xs text-text-secondary tabular-nums" data-testid="kyc-queue-total">
            {data.total} {data.total === 1 ? 'driver' : 'drivers'} awaiting review.
          </p>
        ) : null
      )}

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        onRowClick={(row) => setSelectedId(row.id)}
        emptyTitle="Queue is empty"
        emptyDescription="Every submitted driver has been reviewed. New submissions will appear here."
        pagination={{
          page,
          pageCount: totalPages,
          onPageChange: (next) => {
            // A new page gets a fresh look but keeps the selection — that is
            // the whole point of selecting across pages.
            setSelectedId(null);
            setPage(next);
          },
        }}
        selection={{
          selectedIds,
          getRowId: (row) => row.id,
          onToggle: toggle,
          onToggleAll: toggleAll,
        }}      />

      <p className="text-xs text-text-tertiary">
        Page {page} of {totalPages} · {ADMIN_KYC_PAGE_SIZE} per page · bulk actions cap at{' '}
        {BULK_CAP} drivers.
      </p>

      {/* Keyed by driver: switching rows remounts and drops stale form state.
          Unmounts when the row leaves the queue (decided elsewhere). */}
      {selectedId !== null && selectedExists ? (
        <DriverKycDrawer
          key={selectedId}
          driverId={selectedId}
          page={page}
          onClose={() => {
            setSelectedId(null);
            setPinnedId(null);
          }}
          onSuspended={() => setPinnedId(selectedId)}
        />
      ) : null}

      <BulkDecisionDialog
        open={bulkDecision !== null}
        decision={bulkDecision ?? 'approve'}
        drivers={selectedDrivers}
        onClose={() => setBulkDecision(null)}
        onCompleted={() => {
          // Everything decided left the queue; whatever failed stays listed in
          // the dialog's own results until it is closed.
          setSelected(new Map());
          void refetch();
        }}
      />
    </div>
  );
}
