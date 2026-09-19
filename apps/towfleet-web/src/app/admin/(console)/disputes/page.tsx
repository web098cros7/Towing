'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminDisputesQueue } from '@/features/admin-disputes/components/AdminDisputesQueue';

/**
 * `/admin/disputes` — W8's queue. `useSearchParams` (the `?dispute=` deep
 * link) sits behind Suspense: the page is prerendered, and Next requires a
 * boundary around a hook that reads the query at render time.
 */
export default function AdminDisputesPage() {
  const can = useAdminCan();

  if (!can('dispute.handle')) {
    return (
      <div>
        <PageHeader
          title="Disputes"
          description="Every open complaint, and the five exits that end one."
        />
        <AdminForbidden resource="the dispute queue" />
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
      <AdminDisputesQueue />
    </Suspense>
  );
}
