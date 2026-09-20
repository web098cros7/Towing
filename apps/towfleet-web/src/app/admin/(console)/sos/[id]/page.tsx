'use client';

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { SosDetail } from '@/features/admin-sos/components/SosDetail';

/** `/admin/sos/[id]` — one incident's whole life (§13). */
export default function AdminSosDetailPage() {
  const can = useAdminCan();
  const params = useParams<{ id: string }>();
  const alertId = params?.id ?? null;

  if (!can('sos.handle')) {
    return (
      <div>
        <PageHeader title="SOS incident" description="One incident, every step." />
        <AdminForbidden resource="this incident" />
      </div>
    );
  }
  if (!alertId) return null;

  return <SosDetail alertId={alertId} />;
}
