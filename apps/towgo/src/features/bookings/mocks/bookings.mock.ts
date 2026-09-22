import type { Booking, BookingDetail } from '../types';

/**
 * Detail rows are the single source of truth so the list and the details screen
 * can never drift.
 *
 * PHASE 15 REWROTE THE SHAPE, not the data: money is integer paise, timestamps
 * are ISO 8601, and the image fields are URL strings or null. Those were the
 * Phase 12 contract corrections deferred to "their own phases (15 bookings)" —
 * a mock in rupees with pre-formatted dates would have hidden every one of the
 * unit and parsing bugs the real feed can produce.
 *
 * The truck/driver artwork is `null` here: those are SERVER-sourced images, and
 * the backend has no image pipeline for them yet. The cards already render a
 * themed placeholder when they are absent, which is what mocks-off shows too.
 */
const iso = (day: number, hour: number, minute: number): string =>
  new Date(Date.UTC(2026, 4, day, hour - 5, minute - 30)).toISOString();

export const bookingDetailsMock: BookingDetail[] = [
  {
    id: 'b1',
    reference: 'TW-B1000001',
    serviceSlug: 'car_tow',
    originLabel: 'MG Road, Bengaluru',
    destinationLabel: 'Koramangala, Bengaluru',
    createdAt: iso(17, 10, 30),
    scheduledAt: null,
    status: 'completed',
    farePaise: 125_000,
    routeTone: 'success',
    truckImage: null,
    vehiclePlate: 'KA 01 AB 1234',
    driverName: 'Rajesh Kumar',
    driverRating: 4.8,
    distanceKm: 8.6,
    breakdown: {
      basePaise: 125_000,
      nightPaise: 0,
      highwayPaise: 0,
      accidentPaise: 0,
      surgePaise: 0,
      discountPaise: 0,
      totalPaise: 125_000,
    },
    note: null,
    contactName: null,
    contactMobile: null,
    cancellationReason: null,
    cancellationFeePaise: 0,
    otpAvailable: false,
    // Every mock booking is finished; a completed trip has no live search.
    search: null,
    paymentMethod: 'card',
    driverPhoto: null,
    driverTrips: 128,
    durationMinutes: 45,
  },
  {
    id: 'b4',
    reference: 'TW-B4000004',
    serviceSlug: 'car_tow',
    originLabel: 'Whitefield, Bengaluru',
    destinationLabel: 'Electronic City, Bengaluru',
    createdAt: iso(16, 16, 20),
    scheduledAt: null,
    status: 'completed',
    farePaise: 135_000,
    routeTone: 'info',
    truckImage: null,
    vehiclePlate: 'KA 03 CD 5678',
    driverName: 'Sandeep Yadav',
    driverRating: 4.7,
    distanceKm: 18.3,
    breakdown: {
      basePaise: 135_000,
      nightPaise: 0,
      highwayPaise: 0,
      accidentPaise: 0,
      surgePaise: 0,
      discountPaise: 0,
      totalPaise: 135_000,
    },
    note: null,
    contactName: null,
    contactMobile: null,
    cancellationReason: null,
    cancellationFeePaise: 0,
    otpAvailable: false,
    // Every mock booking is finished; a completed trip has no live search.
    search: null,
    paymentMethod: 'wallet',
    driverPhoto: null,
    driverTrips: 76,
    durationMinutes: 55,
  },
  {
    id: 'b2',
    reference: 'TW-B2000002',
    serviceSlug: 'car_tow',
    originLabel: 'HSR Layout, Bengaluru',
    destinationLabel: 'Jayanagar, Bengaluru',
    createdAt: iso(15, 11, 45),
    scheduledAt: null,
    status: 'completed',
    farePaise: 110_000,
    routeTone: 'info',
    truckImage: null,
    vehiclePlate: 'KA 02 EF 9012',
    driverName: 'Vikram Singh',
    driverRating: 4.9,
    distanceKm: 6.2,
    breakdown: {
      basePaise: 110_000,
      nightPaise: 0,
      highwayPaise: 0,
      accidentPaise: 0,
      surgePaise: 0,
      discountPaise: 0,
      totalPaise: 110_000,
    },
    note: null,
    contactName: null,
    contactMobile: null,
    cancellationReason: null,
    cancellationFeePaise: 0,
    otpAvailable: false,
    // Every mock booking is finished; a completed trip has no live search.
    search: null,
    paymentMethod: 'upi',
    driverPhoto: null,
    driverTrips: 214,
    durationMinutes: 35,
  },
  {
    id: 'b3',
    reference: 'TW-B3000003',
    serviceSlug: 'car_tow',
    originLabel: 'Indiranagar, Bengaluru',
    destinationLabel: 'Whitefield, Bengaluru',
    createdAt: iso(9, 18, 15),
    scheduledAt: null,
    status: 'completed',
    farePaise: 245_000,
    routeTone: 'success',
    truckImage: null,
    vehiclePlate: 'KA 05 CJ 8890',
    driverName: 'Imran Sheikh',
    driverRating: 4.7,
    distanceKm: 21.4,
    breakdown: {
      basePaise: 220_000,
      nightPaise: 25_000,
      highwayPaise: 0,
      accidentPaise: 0,
      surgePaise: 0,
      discountPaise: 0,
      totalPaise: 245_000,
    },
    note: null,
    contactName: null,
    contactMobile: null,
    cancellationReason: null,
    cancellationFeePaise: 0,
    otpAvailable: false,
    // Every mock booking is finished; a completed trip has no live search.
    search: null,
    paymentMethod: 'card',
    driverPhoto: null,
    driverTrips: 96,
    durationMinutes: 80,
  },
];

/** List payload — the detail rows seen through the narrower list type. */
export const bookingsMock: Booking[] = bookingDetailsMock;
