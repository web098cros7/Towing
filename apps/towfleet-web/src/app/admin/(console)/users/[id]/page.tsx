'use client';

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminUserDetail } from '@/features/admin-directory/components/AdminUserDetail';

/**
 * `/admin/users/[id]` — W6's customer detail: profile, trips, notes, and the
 * suspend / reactivate / impersonate actions.
 */
export default function AdminUserDetailPage() {
  const can = useAdminCan();
  const params = useParams<{ id: string }>();
  const userId = params?.id ?? null;

  if (!can('user.read')) {
    return (
      <div>
        <PageHeader title="Customer" description="Account profile and history." />
        <AdminForbidden resource="this customer" />
      </div>
    );
  }
  if (!userId) return null;

  return (
    <div>
      <PageHeader title="Customer" description="Profile, trips and account actions." />
      <AdminUserDetail userId={userId} />
    </div>
  );
}
