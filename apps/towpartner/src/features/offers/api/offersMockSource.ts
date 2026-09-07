import type {
  CallContact,
  DriverJob,
  JobUnable,
  JobUnableResponse,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import { ApiClientError } from '@/lib/api/errors';
import type { OffersDataSource } from './offersDataSource';
import type { JobOffer } from '../types';
import { buildOfferMock } from '../mocks/offer.mock';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Survives an accept so the assigned-job screen has something to show. */
let acceptedJob: DriverJob | null = null;
let declined = false;
/** §9.2.3's attempt cap, mirrored so the capped branch is reachable in mock mode. */
let otpAttempts = 0;

/**
 * The code the mock "customer" is holding.
 *
 * FIXED AND WRITTEN DOWN, because the whole point of mock mode is that the §5.2
 * chain can be walked end to end with no backend and no second device. A random
 * code would make the OTP step a dead end — there would be nothing to type.
 */
const MOCK_OTP = '482913';

const MOCK_MAX_ATTEMPTS = 5;

/**
 * Mock offer lifecycle. `EXPO_PUBLIC_MOCK_OFFER_STATE=none` returns no request
 * so the empty state can be previewed without a backend.
 */
export const offersMockSource: OffersDataSource = {
  async getCurrentOffer(): Promise<JobOffer | null> {
    await delay(500);
    if (env.mockOfferState === 'none' || declined || acceptedJob) return null;
    // Rebuilt per call so `expiresAt` is always ~20s out — a fixed instant would
    // hand the takeover screen an offer that expired at build time.
    return buildOfferMock();
  },

  async getCurrentJob(): Promise<DriverJob | null> {
    await delay(300);
    return acceptedJob;
  },

  async accept(bookingId: string): Promise<DriverJob> {
    await delay(500);
    const offer = buildOfferMock();
    otpAttempts = 0;
    acceptedJob = {
      bookingId,
      reference: offer.reference,
      status: 'assigned',
      serviceType: offer.serviceType,
      vehicleClass: offer.vehicleClass,
      earnings: offer.earnings,
      pickup: offer.pickup,
      pickupAddress: offer.pickupAddress,
      drop: offer.drop,
      dropAddress: offer.dropAddress,
      distanceKm: offer.distanceKm,
      customerName: offer.customerName,
      customerMobile: '+919845020100',
      customerRating: offer.customerRating,
      note: offer.note,
      otpPending: true,
      assignedAt: new Date().toISOString(),
      arrivedAt: null,
      startedAt: null,
      // §7.4's launch values, matching `charge_config`'s column defaults, so the
      // waiting ticker computes the same numbers a real trip would.
      waiting: { freeMinutes: 15, perMinutePaise: 500 },
      etaSeconds: 540,
      routePolyline: null,
      routeDropPolyline: null,
    };
    return acceptedJob;
  },

  async reject(): Promise<void> {
    await delay(250);
    declined = true;
  },

  async arrived(): Promise<DriverJob> {
    await delay(400);
    if (!acceptedJob) throw new Error('No active job');
    acceptedJob = {
      ...acceptedJob,
      status: 'arrived',
      /**
       * BACKDATED BY SIXTEEN MINUTES, one past the free window.
       *
       * A mock that stamped `now` would leave the waiting ticker at zero for a
       * quarter of an hour, which means the one thing this screen adds that
       * cannot be checked any other way — an accruing, billable charge — is
       * unreachable without sitting and waiting. Starting just past the free
       * window puts it immediately on screen and ticking.
       */
      arrivedAt: new Date(Date.now() - 16 * 60_000).toISOString(),
      etaSeconds: null,
    };
    return acceptedJob;
  },

  async start(_bookingId: string, otp: string): Promise<DriverJob> {
    await delay(400);
    if (!acceptedJob) throw new Error('No active job');

    otpAttempts += 1;
    if (otp !== MOCK_OTP || otpAttempts > MOCK_MAX_ATTEMPTS) {
      // The same 409 shape the server sends, so the screen's error branch is
      // exercised rather than an unhandled network failure.
      throw new ApiClientError(409, 'invalid_booking_otp', 'That code is not correct', {
        attemptsRemaining: Math.max(0, MOCK_MAX_ATTEMPTS - otpAttempts),
      });
    }

    acceptedJob = {
      ...acceptedJob,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      otpPending: false,
      etaSeconds: 720,
    };
    return acceptedJob;
  },

  async complete(): Promise<DriverJob> {
    await delay(500);
    if (!acceptedJob) throw new Error('No active job');
    acceptedJob = { ...acceptedJob, status: 'completed', etaSeconds: null };
    const finished = acceptedJob;
    // The driver is idle again, exactly as they are against the real server —
    // `GET /driver/jobs/current` is scoped to active statuses.
    acceptedJob = null;
    declined = false;
    return finished;
  },

  async unable(bookingId: string, _body: JobUnable): Promise<JobUnableResponse> {
    await delay(400);
    acceptedJob = null;
    declined = false;
    return { bookingId, redispatched: true };
  },

  async contact(): Promise<CallContact> {
    await delay(200);
    return {
      // `masked: false`, which is the LIVE behaviour until a masked-calling
      // provider exists (SETUP-CHECKLIST item 13), and the branch that shows the
      // privacy warning. Mocking the masked path would hide the one thing here
      // worth seeing.
      dialNumber: '+919845020100',
      masked: false,
      party: 'customer',
      displayName: acceptedJob?.customerName ?? 'Customer',
      reference: null,
    };
  },
};

/** The code a tester types in mock mode. Surfaced so the Maestro flow can use it. */
export const MOCK_BOOKING_OTP = MOCK_OTP;
