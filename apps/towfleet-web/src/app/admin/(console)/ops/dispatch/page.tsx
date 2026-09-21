'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminDispatchSearches } from '@/features/admin-ops/components/AdminDispatchSearches';

/**
 * `/admin/ops/dispatch` — W5's live searches (§9.4.6), the inspector's index.
 *
 * Lives under Ops rather than beside the sidebar's `dispatch` item: that one is
 * W12's config editor (`dispatch.config`), a different permission for a
 * different job.
 */
export default function AdminDispatchSearchesPage() {
  const can = useAdminCan();

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
        title="Dispatch inspector"
        description="Live searches, oldest first — the longest wait is on top."
      />
      <AdminDispatchSearches />
    </div>
  );
}
