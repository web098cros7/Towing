'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { NotificationsPanel } from '@/features/admin-notifications/components/NotificationsPanel';

/** `/admin/settings/notifications` — W18's notification console (§12.3). */
export default function AdminNotificationsPage() {
  const can = useAdminCan();

  if (!can('notification.view')) {
    return (
      <div>
        <PageHeader
          title="Notifications"
          description="Template catalogue, delivery log and the guarded test-send."
        />
        <AdminForbidden resource="the notification console" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="What can send, what did send, and a guarded test to your own contact."
      />
      <NotificationsPanel />
    </div>
  );
}
