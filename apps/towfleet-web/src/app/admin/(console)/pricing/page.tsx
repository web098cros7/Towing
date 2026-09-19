'use client';

import { useState } from 'react';
import { Button, Skeleton } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { useAdminPricing } from '@/features/admin-pricing/api/adminPricing.queries';
import { ChargeSettingsForm } from '@/features/admin-pricing/components/ChargeSettingsForm';
import { PricingHistoryDrawer } from '@/features/admin-pricing/components/PricingHistoryDrawer';
import { PricingMatrices } from '@/features/admin-pricing/components/PricingMatrices';
import { WorkedExample } from '@/features/admin-pricing/components/WorkedExample';

/**
 * `/admin/pricing` — W10's fare editor (§9.4.8).
 *
 * WHAT AN OPERATOR CAN CHANGE HERE: both slab matrices, the §7.3 long-distance
 * ranges, the flat roadside fares, the §7.4 charges, the night window and the
 * surge percentages. What they cannot is a "vehicle multiplier" — decision G9,
 * the vehicle class selects a table, it does not scale one.
 *
 * EFFECTIVE IMMEDIATELY is already true by construction: every write
 * invalidates the rate-card cache, the zone resolver never caches, and a fare
 * locked at confirm keeps its numbers. The copy under the tables says so
 * because it is the question every operator asks first.
 *
 * G1 (W10) gives `operations` this screen alongside finance and super admin:
 * §4.2's matrix grants Operations the pricing and surge levers, and the
 * permission map the sidebar filters on always said so.
 */
export default function AdminPricingPage() {
  const can = useAdminCan();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data, isLoading, isError } = useAdminPricing();

  if (!can('pricing.edit')) {
    return (
      <div>
        <PageHeader title="Pricing" description="Base fares, charges and surge." />
        <AdminForbidden resource="the pricing editor" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Pricing"
        description="Every number a fare is built from, editable with no deploy."
        actions={
          <Button variant="outline" onClick={() => setHistoryOpen(true)} data-testid="pricing-history-open">
            History
          </Button>
        }
      />

      {isError ? (
        <p className="text-sm text-error">Could not load the rate card.</p>
      ) : isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="space-y-5">
          <PricingMatrices config={data} canEdit={can('pricing.edit')} />
          <ChargeSettingsForm config={data} canEdit={can('pricing.edit')} />
          <WorkedExample charges={data.charges} rules={data.rules} />

          <p className="text-xs text-text-tertiary">
            New bookings price from a save immediately; fares already locked on a booking do not
            move. Every change is audited with its before and after.
          </p>
        </div>
      )}

      <PricingHistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
