'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { SupportQueue } from '@/features/admin-support/components/SupportQueue';

/** `/admin/support` — W15's ticket queue (§9.4.12). */
export default function AdminSupportPage() {
  const can = useAdminCan();

  if (!can('ticket.handle')) {
    return (
      <div>
        <PageHeader title="Support" description="Tickets from customers, drivers and fleets." />
        <AdminForbidden resource="the support console" />
      </div>
    );
  }

  return <SupportQueue />;
}
