'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, DataTable, Tabs, type ColumnDef } from '@towing/web-ui';
import type { AdminDirectoryBooking } from '@towing/api-contracts';
import { useAdminCan } from '@/components/admin/Can';
import { ApiError } from '@/lib/apiClient';
import { NotesPanel } from '@/features/admin-notes/components/NotesPanel';
import { useAdminDirectoryUser, useAdminDirectoryUserBookings } from '../api/adminDirectory.queries';
import {
  useReactivateUser,
  useStartImpersonation,
  useSuspendUser,
} from '../api/adminDirectory.mutations';
import { SuspendSubjectDialog } from './SuspendSubjectDialog';

const bookingColumns: ColumnDef<AdminDirectoryBooking, unknown>[] = [
  { accessorKey: 'id', header: 'Booking', cell: ({ row }) => <span className="font-mono text-xs">{row.original.id.slice(0, 8)}</span> },
  { accessorKey: 'status', header: 'Status', cell: ({ row }) => <Badge variant="neutral">{row.original.status}</Badge> },
  { accessorKey: 'serviceType', header: 'Service' },
  {
    accessorKey: 'totalPaise',
    header: 'Total',
    cell: ({ row }) => `₹${(row.original.totalPaise / 100).toLocaleString('en-IN')}`,
  },
  {
    accessorKey: 'createdAt',
    header: 'When',
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleString('en-IN'),
  },
];

/**
 * W6's customer detail (§9.4.4): profile, trips, notes — and the three
 * account-level actions, each honest about what the caller may do.
 */
export function AdminUserDetail({ userId }: { userId: string }) {
  const router = useRouter();
  const can = useAdminCan();
  const canSuspend = can('user.suspend');
  const canImpersonate = can('impersonate.read');

  const user = useAdminDirectoryUser(userId);
  const bookings = useAdminDirectoryUserBookings(userId, 1);
  const suspend = useSuspendUser();
  const reactivate = useReactivateUser();
  const impersonate = useStartImpersonation();

  const [tab, setTab] = useState<'profile' | 'trips' | 'notes'>('profile');
  const [suspending, setSuspending] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);
  const [reactivating, setReactivating] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [impersonateError, setImpersonateError] = useState<string | null>(null);

  if (user.isLoading) {
    return <Card className="p-6">Loading customer…</Card>;
  }
  if (user.isError || !user.data) {
    return (
      <Card className="p-6 text-sm text-text-secondary" data-testid="admin-user-missing">
        This customer could not be loaded.
      </Card>
    );
  }

  const row = user.data;

  return (
    <div className="space-y-4" data-testid="admin-user-detail">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{row.name ?? 'Unnamed customer'}</h1>
            <p className="text-sm text-text-secondary">
              {row.mobile}
              {row.email ? ` · ${row.email}` : ''}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={row.status === 'active' ? 'success' : 'error'}>{row.status}</Badge>
              <span className="text-xs text-text-secondary">
                {row.bookingsCount} booking{row.bookingsCount === 1 ? '' : 's'} lifetime
              </span>
            </div>
            {row.suspensionReason ? (
              <p className="mt-2 text-sm text-error" data-testid="admin-user-suspension-reason">
                Suspended: {row.suspensionReason}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {canImpersonate ? (
              <Button
                variant="outline"
                data-testid="admin-user-impersonate"
                onClick={() => {
                  setImpersonateError(null);
                  setImpersonating(true);
                }}
              >
                Impersonate (read-only)
              </Button>
            ) : null}
            {row.status === 'active' ? (
              <Button
                variant="destructive"
                data-testid="admin-user-detail-suspend"
                onClick={() => {
                  setSuspendError(null);
                  setSuspending(true);
                }}
              >
                {canSuspend ? 'Suspend' : 'Request suspension'}
              </Button>
            ) : canSuspend ? (
              <Button
                variant="secondary"
                data-testid="admin-user-reactivate"
                disabled={reactivate.isPending}
                onClick={() =>
                  void reactivate
                    .mutateAsync({ userId })
                    .catch((error: unknown) =>
                      setSuspendError(error instanceof ApiError ? error.message : 'Reactivate failed'),
                    )
                }
              >
                Reactivate
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Tabs
        aria-label="Customer sections"
        value={tab}
        onChange={(value) => setTab(value)}
        items={[
          { value: 'profile', label: 'Profile' },
          { value: 'trips', label: 'Trips' },
          { value: 'notes', label: 'Notes' },
        ]}
      />

      {tab === 'profile' ? (
        <Card className="grid grid-cols-2 gap-4 p-6 text-sm md:grid-cols-4">
          <div>
            <div className="text-text-secondary">Joined</div>
            <div>{new Date(row.createdAt).toLocaleDateString('en-IN')}</div>
          </div>
          <div>
            <div className="text-text-secondary">Customer id</div>
            <div className="font-mono text-xs">{row.id}</div>
          </div>
          <div>
            <div className="text-text-secondary">Suspended at</div>
            <div>{row.suspendedAt ? new Date(row.suspendedAt).toLocaleString('en-IN') : '—'}</div>
          </div>
        </Card>
      ) : null}

      {tab === 'trips' ? (
        <DataTable
          columns={bookingColumns}
          data={bookings.data?.items ?? []}
          isLoading={bookings.isLoading}
          isError={bookings.isError}
          onRetry={() => void bookings.refetch()}
          emptyTitle="No trips yet"
          emptyDescription="This customer has not booked a tow."
        />
      ) : null}

      {tab === 'notes' ? <NotesPanel subjectType="user" subjectId={userId} /> : null}

      <SuspendSubjectDialog
        open={suspending}
        onClose={() => setSuspending(false)}
        title={`Suspend ${row.name ?? row.mobile}?`}
        description={
          canSuspend
            ? 'Searching bookings are cancelled fee-free. An active trip keeps running.'
            : 'Your role cannot perform suspensions — a request will be filed for approval.'
        }
        errorMessage={suspendError}
        onConfirm={async (reason) => {
          try {
            await suspend.mutateAsync({ userId, reason });
            setSuspending(false);
          } catch (error) {
            setSuspendError(error instanceof ApiError ? error.message : 'Suspension failed.');
          }
        }}
      />

      <SuspendSubjectDialog
        open={impersonating}
        onClose={() => setImpersonating(false)}
        title={`View ${row.name ?? row.mobile}'s app (read-only)`}
        description="Reads render what the customer sees and are audited against this session. No write route accepts it, and no token is minted."
        confirmLabel="Start read-only session"
        submitVariant="primary"
        errorMessage={impersonateError}
        testId="impersonate-dialog"
        onConfirm={async (reason) => {
          try {
            const { session } = await impersonate.mutateAsync({ userId, reason });
            router.push(`/admin/users/${userId}/app-view?session=${session.id}`);
          } catch (error) {
            setImpersonateError(error instanceof ApiError ? error.message : 'Could not start the session.');
          }
        }}
      />
    </div>
  );
}
