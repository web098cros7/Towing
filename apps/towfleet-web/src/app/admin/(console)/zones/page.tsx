'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminZonesScreen } from '@/features/admin-zones/AdminZonesScreen';

/**
 * `/admin/zones` — W13's §9.4.8 service-zone editor.
 *
 * `zone.edit` — super admin and operations, the same pair that owns the
 * dispatch screen: a zone is the shape half of "where do we operate", and the
 * person who answers a marketplace that has gone quiet is the person drawing
 * the box.
 */
export default function AdminZonesPage() {
  const can = useAdminCan();

  if (!can('zone.edit')) {
    return (
      <div>
        <PageHeader
          title="Zones"
          description="Draw the service areas the resolver prices and dispatches from."
        />
        <AdminForbidden resource="the service-zone editor" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Zones"
        description="Draw the service areas the resolver prices and dispatches from."
      />
      <AdminZonesScreen />
    </div>
  );
}
