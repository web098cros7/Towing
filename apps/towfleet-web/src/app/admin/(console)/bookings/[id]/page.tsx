'use client';

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { BookingDetailScreen } from '@/features/admin-bookings/components/BookingDetailScreen';

/** `/admin/bookings/[id]` — W8's booking detail: snapshot, history, actions. */
export default function AdminBookingDetailPage() {
  const can = useAdminCan();
  const params = useParams<{ id: string }>();
  const bookingId = params?.id ?? null;

  if (!can('booking.read')) {
    return (
      <div>
        <PageHeader title="Booking" description="One booking, every intervention." />
        <AdminForbidden resource="this booking" />
      </div>
    );
  }
  if (!bookingId) return null;

  return <BookingDetailScreen bookingId={bookingId} />;
}
