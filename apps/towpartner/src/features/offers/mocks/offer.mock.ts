import type { JobOffer } from '../types';

/**
 * The incoming request shown on the New Job screen (Figma driver "New Job").
 *
 * REBUILT ON THE CONTRACT SHAPE IN PHASE 17. The old fixture carried a single
 * `fare: 850` — which was the gross — and a relative `expiresInSeconds: 165`.
 * Both are gone: the money is the gross → commission → net triple the server
 * locks at confirm, and the expiry is an absolute instant computed fresh on each
 * read so the mock countdown behaves like the real one.
 */
export function buildOfferMock(): JobOffer {
  const grossPaise = 85_000;
  // §3.3 Band A: 10 %. Spelled out rather than pre-computed, so the mock cannot
  // drift into showing a net that is not gross minus commission.
  const commissionPaise = Math.round(grossPaise * 0.1);

  return {
    bookingId: '00000000-0000-4000-8000-0000000000a1',
    reference: 'TW-A1B2C3D4',
    serviceType: 'tow',
    vehicleClass: 'flatbed',
    // Recomputed per call: a fixture with a fixed instant would show an offer
    // that expired the moment the app was rebuilt.
    expiresAt: new Date(Date.now() + 20_000).toISOString(),
    earnings: {
      grossPaise,
      band: 'A',
      commissionPct: 10,
      commissionPaise,
      netPaise: grossPaise - commissionPaise,
      payModel: 'independent',
      driverSharePaise: grossPaise - commissionPaise,
      fleetSharePaise: 0,
    },
    pickup: { lat: 28.5921, lng: 77.0797 },
    pickupAddress: 'Palam, Delhi',
    drop: { lat: 28.5921, lng: 77.046 },
    dropAddress: 'Dwarka, Delhi',
    distanceKm: 12.4,
    distanceToPickupMeters: 2_400,
    customerRating: 4.6,
    customerName: 'Rahul',
    note: 'Car not starting. Need towing to Dwarka workshop.',
    wave: 1,

    // Display-only extras the wire does not carry yet.
    vehicleName: 'Maruti Swift',
    vehicleColor: 'White',
    vehiclePlate: 'DL 4C AB 1234',
    payment: 'online',
    towTypeLabel: 'Car Tow',
  };
}

/** @deprecated Use `buildOfferMock()` — a fixed `expiresAt` expires. */
export const offerMock = buildOfferMock();
