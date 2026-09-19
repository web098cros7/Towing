'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminBookingsList } from '@/features/admin-bookings/components/AdminBookingsList';

/** `/admin/bookings` — W8's bookings console list. */
export default function AdminBookingsPage() {
  const can = useAdminCan();

  if (!can('booking.read')) {
    return (
      <div>
        <PageHeader
          title="Bookings"
          description="Every booking, with the interventions an operator can run on one."
        />
        <AdminForbidden resource="the bookings console" />
      </div>
    );
  }

  return <AdminBookingsList />;
}
