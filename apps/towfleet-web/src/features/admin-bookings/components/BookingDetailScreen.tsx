'use client';

import { ErrorState, Skeleton, StatusChip } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { ApiError } from '@/lib/apiClient';
import { useAdminBooking } from '../api/adminBookings.queries';
import { BookingActions } from './BookingActions';
import { BookingDetail } from './BookingDetail';
import { BOOKING_STATUS_TONES } from './bookingStatus';

/**
 * The detail screen's data wrapper: query, headers, 403, and the actions row.
 * The pure view (`BookingDetail`) and the mutations (`BookingActions`) stay
 * separate so the layout is testable without a data layer and the action
 * gating is readable on its own.
 */
export function BookingDetailScreen({ bookingId }: { bookingId: string }) {
  const { data, isLoading, isError, error, refetch } = useAdminBooking(bookingId);

  if (error instanceof ApiError && error.status === 403) {
    return (
      <div>
        <PageHeader title="Booking" description="One booking, every intervention." />
        <AdminForbidden resource="this booking" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorState onRetry={() => void refetch()} />;
  }

  return (
    <div>
      <PageHeader
        title={data.code}
        description={`${data.serviceType.replace(/_/g, ' ')} · ${data.vehicleClass.replace(/_/g, ' ')} · created ${new Date(data.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip
              status={data.status}
              tone={BOOKING_STATUS_TONES[data.status]}
              data-testid="booking-status"
            />
            <BookingActions detail={data} />
          </div>
        }
      />
      <BookingDetail detail={data} />
    </div>
  );
}
