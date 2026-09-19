'use client';

import { Skeleton } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useAdminCan } from '@/components/admin/Can';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';
import { AdminOpsHome } from '@/features/admin-ops/components/AdminOpsHome';
import { AdminQuickLinks } from '@/features/admin-ops/components/QuickLinks';

/**
 * `/admin` — W3's ops dashboard for `ops.live` holders (§9.4.2), with the
 * neutral quick links kept for the one sub-role that does not hold it.
 *
 * Finance lacks `ops.live`, so a dashboard here would greet it with a 403 on
 * the URL it lands on; a redirect would re-introduce the role routing M0-F7
 * removed. The permission check is the same map the guard enforces
 * server-side, so the UI and the API cannot disagree about who may look.
 *
 * LIVES INSIDE `(console)` AS OF W1: it used to sit at `app/admin/page.tsx`,
 * a sibling of the console route group, so `/admin` — the one URL every admin
 * lands on — was the only screen without the shell.
 */
export default function AdminHomePage() {
  const { admin, isLoading } = useAdminIdentity();
  const can = useAdminCan();

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Operations" description="Platform operations console." />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (!admin || !can('ops.live')) {
    return (
      <div>
        <PageHeader
          title="Operations"
          description="Platform operations console. Choose a queue to start working."
        />
        <AdminQuickLinks />
      </div>
    );
  }

  return <AdminOpsHome />;
}
