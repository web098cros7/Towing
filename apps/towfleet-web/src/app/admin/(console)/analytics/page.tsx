'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AnalyticsPanel } from '@/features/admin-analytics/components/AnalyticsPanel';

/** `/admin/analytics` — W17 (§9.4.13, §22.2). */
export default function AdminAnalyticsPage() {
  const can = useAdminCan();

  if (!can('analytics.view')) {
    return (
      <div>
        <PageHeader title="Analytics" description="Marketplace, revenue, drivers and geography." />
        <AdminForbidden resource="the analytics console" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Rolled up nightly; today is computed live. Money crosses in paise, rates in basis points — the page does the dividing."
      />
      <AnalyticsPanel />
    </div>
  );
}
