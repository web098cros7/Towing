'use client';

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminFleetDetail } from '@/features/admin-directory/components/AdminFleetDetail';

/**
 * `/admin/fleets/[id]` — W6's fleet detail: profile with dry-run counts,
 * trucks/drivers/earnings through the fleet console's services, and A15's
 * suspend behind a typed-name confirmation.
 */
export default function AdminFleetDetailPage() {
  const can = useAdminCan();
  const params = useParams<{ id: string }>();
  const fleetId = params?.id ?? null;

  if (!can('user.read')) {
    return (
      <div>
        <PageHeader title="Fleet" description="Fleet profile and supply." />
        <AdminForbidden resource="this fleet" />
      </div>
    );
  }
  if (!fleetId) return null;

  return (
    <div>
      <PageHeader title="Fleet" description="Profile, trucks, drivers, earnings and account actions." />
      <AdminFleetDetail fleetId={fleetId} />
    </div>
  );
}
