'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { QuotesPanel } from '@/features/admin-quotes/components/QuotesPanel';

/**
 * `/admin/quotes` — W20's manual-quote queue (§7.3).
 *
 * Gated on `quote.manage`, which operations, finance and super admin hold;
 * support does not, so a support admin gets the forbidden card rather than a
 * queue whose buttons would 403.
 */
export default function AdminQuotesPage() {
  const can = useAdminCan();

  if (!can('quote.manage')) {
    return (
      <div>
        <PageHeader title="Quotes" description="Manual quotes for long-distance jobs." />
        <AdminForbidden resource="the quote queue" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Quotes"
        description="Long-distance requests the engine will not price — file a number the customer can accept."
      />
      <QuotesPanel />
    </div>
  );
}
