'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { SosQueue } from '@/features/admin-sos/components/SosQueue';

/** `/admin/sos` — W14's queue (§13). */
export default function AdminSosPage() {
  const can = useAdminCan();

  if (!can('sos.handle')) {
    return (
      <div>
        <PageHeader title="SOS" description="Incidents in progress." />
        <AdminForbidden resource="the SOS console" />
      </div>
    );
  }

  return <SosQueue />;
}
