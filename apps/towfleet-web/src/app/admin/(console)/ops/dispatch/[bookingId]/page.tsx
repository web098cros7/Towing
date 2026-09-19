'use client';

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminDispatchInspector } from '@/features/admin-ops/components/AdminDispatchInspector';

/**
 * `/admin/ops/dispatch/[bookingId]` — W5's inspector for one booking (§9.4.6).
 *
 * The permission gate follows the list page's; the API enforces the same
 * permission again server-side, so this is an explanation, not a boundary.
 */
export default function AdminDispatchInspectorPage() {
  const can = useAdminCan();
  const params = useParams<{ bookingId: string }>();
  const bookingId = params?.bookingId ?? '';

  if (!can('ops.dispatch.inspect')) {
    return (
      <div>
        <PageHeader title="Dispatch inspector" description="Why each wave chose who it chose." />
        <AdminForbidden resource="the dispatch inspector" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`Dispatch inspector · ${bookingId.slice(0, 8)}`}
        description="Every wave, every term, every exclusion."
      />
      <AdminDispatchInspector bookingId={bookingId} />
    </div>
  );
}
