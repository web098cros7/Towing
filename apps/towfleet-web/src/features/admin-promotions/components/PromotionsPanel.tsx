'use client';

import { useState } from 'react';
import { Tabs } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { BannersPanel } from './BannersPanel';
import { CouponsPanel } from './CouponsPanel';

/**
 * `/admin/promotions` — W16's screen: coupons on one tab, the carousel on the
 * other. One route because §9.4.11 is one capability with one permission
 * (`promo.manage`); two routes would have duplicated the gate for no gain.
 */
export function PromotionsPanel() {
  const [tab, setTab] = useState<'coupons' | 'banners'>('coupons');

  return (
    <div>
      <PageHeader
        title="Promotions"
        description="Coupon codes and the app carousel — both read and enforced by the server, never by the client."
      />

      <Tabs
        items={[
          { value: 'coupons', label: 'Coupons' },
          { value: 'banners', label: 'Banners' },
        ]}
        value={tab}
        onChange={setTab}
        aria-label="Promotions section"
      />

      <div className="mt-4">{tab === 'coupons' ? <CouponsPanel /> : <BannersPanel />}</div>
    </div>
  );
}
