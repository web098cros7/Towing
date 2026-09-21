'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { PromotionsPanel } from '@/features/admin-promotions/components/PromotionsPanel';

/** `/admin/promotions` — W16's promotions console (§9.4.11). */
export default function AdminPromotionsPage() {
  const can = useAdminCan();

  if (!can('promo.manage')) {
    return (
      <div>
        <PageHeader title="Promotions" description="Coupon codes and the app carousel." />
        <AdminForbidden resource="the promotions console" />
      </div>
    );
  }

  return <PromotionsPanel />;
}
