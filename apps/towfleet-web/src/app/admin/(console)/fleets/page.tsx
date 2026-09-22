'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminFleetsDirectory } from '@/features/admin-directory/components/AdminFleetsDirectory';

/**
 * `/admin/fleets` — W6's fleet directory (§9.4.5) with the suspend dry-run
 * counts inline.
 */
export default function AdminFleetsPage() {
  const can = useAdminCan();

  if (!can('user.read')) {
    return (
      <div>
        <PageHeader title="Fleets" description="Every fleet business on the platform." />
        <AdminForbidden resource="the fleet directory" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Fleets"
        description="Fleet businesses, their supply, and the one action that can take it all offline."
      />
      <AdminFleetsDirectory />
    </div>
  );
}
