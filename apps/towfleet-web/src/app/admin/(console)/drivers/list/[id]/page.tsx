'use client';

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminDriverDetail } from '@/features/admin-directory/components/AdminDriverDetail';

/**
 * `/admin/drivers/list/[id]` — W6's driver detail: profile, the §6.10 zones
 * editor, trips and notes, with A14's suspend/reactivate.
 */
export default function AdminDriverDetailPage() {
  const can = useAdminCan();
  const params = useParams<{ id: string }>();
  const driverId = params?.id ?? null;

  if (!can('user.read')) {
    return (
      <div>
        <PageHeader title="Driver" description="Profile and history." />
        <AdminForbidden resource="this driver" />
      </div>
    );
  }
  if (!driverId) return null;

  return (
    <div>
      <PageHeader title="Driver" description="Profile, zones, trips and account actions." />
      <AdminDriverDetail driverId={driverId} />
    </div>
  );
}
