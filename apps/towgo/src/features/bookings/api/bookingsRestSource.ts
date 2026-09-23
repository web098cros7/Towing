import type { PaymentCaptureRequest } from '@towing/api-contracts';
import type {
  Booking as ApiBooking,
  BookingCancelResponse,
  BookingCreate,
  BookingDetail as ApiBookingDetail,
  BookingListResponse,
  BookingOtpResponse,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import { ApiClientError } from '@/lib/api/errors';
import type { Booking, BookingDetail } from '../types';
import type { BookingsDataSource, BookingsPage } from './bookingsDataSource';

/**
 * The app's label for an address the server does not have: a roadside job with no
 * drop, or an old row with no pickup label. The same dash the mock source uses.
 */
const NO_ADDRESS = '—';

/**
 * `bookingSchema` → the app's `Booking`.
 *
 * THE WIRE SHAPE IS NOT THE APP SHAPE, and until 20 Booking Details was rebuilt
 * nothing mapped between them: every REST read was cast straight to the app type,
 * so on the live API `originLabel` / `destinationLabel` / `farePaise` read
 * `undefined` (the contract calls them `pickupAddress`, `dropAddress` and
 * `breakdown.totalPaise`). Only the mock source filled the app shape.
 *
 * The two points travel as `pickupPoint` / `dropPoint`: nothing draws them, but
 * 10's recent places read a past trip's addresses back from this list.
 *
 * The contract now carries the driver on the booking itself (`driver:
 * TrackedDriver | null`), so the plate, name and rating map straight across;
 * the tracking payload still carries the live position and the make/model.
 */
function toBooking(api: ApiBooking): Booking {
  return {
    id: api.id,
    reference: api.reference,
    serviceSlug: api.serviceSlug,
    originLabel: api.pickupAddress ?? NO_ADDRESS,
    destinationLabel: api.dropAddress ?? NO_ADDRESS,
    pickupPoint: api.pickup,
    dropPoint: api.drop,
    createdAt: api.createdAt,
    scheduledAt: api.scheduledAt,
    status: api.status,
    farePaise: api.breakdown.totalPaise,
    routeTone: api.status === 'completed' || api.status === 'paid' ? 'success' : 'info',
    truckImage: null,
    vehiclePlate: api.driver?.vehiclePlate ?? null,
    driverName: api.driver?.name ?? null,
    driverRating: api.driver?.rating ?? null,
  };
}

/**
 * `bookingDetailSchema` → the app's `BookingDetail`. The contract now carries
 * the payment method, the driver's photo and trip count, and the six trip
 * instants; `durationMinutes` is derived from `startedAt` and `completedAt`.
 */
function toBookingDetail(api: ApiBookingDetail): BookingDetail {
  const { startedAt, completedAt } = api;
  const durationMinutes =
    startedAt !== null && completedAt !== null
      ? Math.max(1, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 60000))
      : null;
  return {
    ...toBooking(api),
    distanceKm: api.distanceKm,
    breakdown: {
      basePaise: api.breakdown.basePaise,
      nightPaise: api.breakdown.nightPaise,
      highwayPaise: api.breakdown.highwayPaise,
      accidentPaise: api.breakdown.accidentPaise,
      surgePaise: api.breakdown.surgePaise,
      discountPaise: api.breakdown.discountPaise,
      totalPaise: api.breakdown.totalPaise,
    },
    note: api.note,
    contactName: api.contactName,
    contactMobile: api.contactMobile,
    cancellationReason: api.cancellationReason,
    cancellationFeePaise: api.cancellationFeePaise,
    otpAvailable: api.otpAvailable,
    search: api.search,
    paymentMethod: api.paymentMethod,
    driverPhoto: api.driver?.photoUrl ?? null,
    driverTrips: api.driver?.totalTrips ?? null,
    paidAt: api.paidAt,
    assignedAt: api.assignedAt,
    enRouteAt: api.enRouteAt,
    arrivedAt: api.arrivedAt,
    startedAt: api.startedAt,
    completedAt: api.completedAt,
    durationMinutes,
  };
}

export const bookingsRestSource: BookingsDataSource = {
  async getBookings(cursor?: string): Promise<BookingsPage> {
    const page = await apiFetch<BookingListResponse>(
      `bookings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    return { items: page.items.map(toBooking), nextCursor: page.nextCursor };
  },

  /**
   * A 404 is "no such booking", not a failure — the interface says so, and the
   * detail screen renders an empty state rather than an error for it. Anything
   * else propagates.
   */
  async getBooking(bookingId: string): Promise<BookingDetail | null> {
    try {
      return toBookingDetail(await apiFetch<ApiBookingDetail>(`bookings/${bookingId}`));
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) return null;
      throw error;
    }
  },

  async createBooking(input: BookingCreate, idempotencyKey: string): Promise<BookingDetail> {
    const created = await apiFetch<ApiBookingDetail>('bookings', {
      method: 'POST',
      body: JSON.stringify(input),
      // The key is passed EXPLICITLY rather than via `idempotent: true`, because
      // it must survive a retry: a caller-supplied header is the one thing
      // `mintIdempotencyKey` will not replace. §19.4 requires a replay to reuse
      // the original key, and a fresh one per attempt would create a second
      // fare-locked booking.
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return toBookingDetail(created);
  },

  cancelBooking: (
    bookingId: string,
    reason?: string,
    payment?: PaymentCaptureRequest,
  ): Promise<BookingCancelResponse> =>
    apiFetch<BookingCancelResponse>(`bookings/${bookingId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ ...(reason ? { reason } : {}), ...(payment ? { payment } : {}) }),
      idempotent: true,
    }),

  getOtp: (bookingId: string): Promise<BookingOtpResponse> =>
    apiFetch<BookingOtpResponse>(`bookings/${bookingId}/otp`),

  async retrySearch(bookingId: string): Promise<BookingDetail> {
    const retried = await apiFetch<ApiBookingDetail>(`bookings/${bookingId}/retry-search`, {
      method: 'POST',
      // A retry is a fresh intent each time the customer taps it, not a replay —
      // so `idempotent: true` mints a new key per attempt rather than replaying
      // the previous search's response.
      idempotent: true,
    });
    return toBookingDetail(retried);
  },
};
