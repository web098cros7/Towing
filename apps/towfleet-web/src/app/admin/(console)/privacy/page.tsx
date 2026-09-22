'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { PrivacyPanel } from '@/features/admin-privacy/components/PrivacyPanel';

/**
 * `/admin/privacy` — W19's DPDP lane (§20.4): the deletion queue, the
 * retention schedule, and the evidence log behind each executed erasure.
 *
 * Gated on `privacy.handle`, which is super_admin and support — operations
 * does not hold it (the §4.2 matrix), so an ops admin who bookmarks the page
 * gets the forbidden card rather than a queue they cannot act on.
 */
export default function AdminPrivacyPage() {
  const can = useAdminCan();

  if (!can('privacy.handle')) {
    return (
      <div>
        <PageHeader title="Privacy" description="Deletion requests and retention." />
        <AdminForbidden resource="the privacy queue" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Privacy"
        description="Deletion requests, the erasure log, and the retention schedule the sweep reads."
      />
      <PrivacyPanel />
    </div>
  );
}
