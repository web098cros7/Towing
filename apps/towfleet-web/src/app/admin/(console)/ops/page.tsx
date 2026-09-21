'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminLiveOps } from '@/features/admin-ops/components/AdminLiveOps';

/**
 * `/admin/ops` — W4's live map (the sidebar's "Live Ops", `ops.live`).
 *
 * The gate is the same permission map the server enforces, so a role without
 * `ops.live` (finance) gets an explanation rather than a stream of 403s from
 * the snapshot query.
 */
export default function AdminLiveOpsPage() {
  const can = useAdminCan();

  if (!can('ops.live')) {
    return (
      <div>
        <PageHeader title="Live Ops" description="Every online driver and active job on one map." />
        <AdminForbidden resource="the live operations map" />
      </div>
    );
  }

  return <AdminLiveOps />;
}
