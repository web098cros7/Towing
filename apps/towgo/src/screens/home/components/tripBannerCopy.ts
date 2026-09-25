import type { BookingTracking } from '@towing/api-contracts';
import type { Booking } from '@/features/bookings/types';
import { areaOf, isRoadsideTrip } from '@/screens/booking/tracking/trackingDisplay';

/**
 * The banner's two lines for each live stage. The design draws the tow
 * ("Drop by 10:50 AM" / "Heading to Indiranagar"); the rest follow its shape:
 * the next thing that happens, then where.
 */
export function bannerCopy(
  booking: Pick<Booking, 'originLabel' | 'destinationLabel'>,
  tracking: BookingTracking | undefined,
  status: Booking['status'],
  arrival: string | null,
): { title: string; subtitle: string } {
  const pickup = areaOf(booking.originLabel) ?? 'your pickup';
  const drop = areaOf(booking.destinationLabel);
  switch (status) {
    case 'searching':
      return { title: 'Finding your driver', subtitle: `Pickup at ${pickup}` };
    case 'arrived':
      return { title: 'Your driver is here', subtitle: `At ${pickup}` };
    case 'in_progress':
      if (isRoadsideTrip(tracking) || !drop) {
        return { title: 'Service in progress', subtitle: `At ${pickup}` };
      }
      return {
        title: arrival ? `Drop by ${arrival}` : 'Towing your vehicle',
        subtitle: `Heading to ${drop}`,
      };
    default:
      // assigned / en_route: the driver is on the way to the pickup.
      return {
        title: arrival ? `Arriving by ${arrival}` : 'Driver on the way',
        subtitle: `Heading to ${pickup}`,
      };
  }
}
