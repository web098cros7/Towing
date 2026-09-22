'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminAppView } from '@/features/admin-directory/components/AdminAppView';

/**
 * `/admin/users/[id]/app-view?session=...` — G8's read-only impersonation.
 *
 * The session id is part of the URL on purpose: a shared link is useless (it
 * belongs to ONE admin's session and every read is audited), and a reload
 * rejoins the same session rather than forking one.
 */
export default function AdminAppViewPage() {
  const can = useAdminCan();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const userId = params?.id ?? null;
  const sessionId = search.get('session');

  if (!can('impersonate.read')) {
    return (
      <div>
        <PageHeader title="Customer app view" description="What the customer sees, read-only." />
        <AdminForbidden resource="customer impersonation" />
      </div>
    );
  }
  if (!userId || !sessionId) {
    return (
      <div>
        <PageHeader title="Customer app view" description="What the customer sees, read-only." />
        <p className="text-sm text-text-secondary" data-testid="app-view-no-session">
          Start a read-only session from the customer page to view this screen.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Customer app view"
        description="The five sections the customer sees, rendered read-only."
      />
      <AdminAppView userId={userId} sessionId={sessionId} />
    </div>
  );
}
