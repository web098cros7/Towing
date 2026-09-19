'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminDriversDirectory } from '@/features/admin-directory/components/AdminDriversDirectory';

/**
 * `/admin/drivers/list` — W6's drivers directory (§9.4.4). The KYC QUEUE
 * stays at `/admin/drivers`; this is the searchable directory view.
 */
export default function AdminDriversDirectoryPage() {
  const can = useAdminCan();

  if (!can('user.read')) {
    return (
      <div>
        <PageHeader title="Drivers" description="Every driver on the platform." />
        <AdminForbidden resource="the driver directory" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Drivers"
        description="Find any driver by name, mobile or id — with their §3.2 eligibility facts."
      />
      <AdminDriversDirectory />
    </div>
  );
}
