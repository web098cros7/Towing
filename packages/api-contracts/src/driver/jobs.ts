import { z } from 'zod';
import { serviceTypeSchema } from '../common/enums';
import { geoPointSchema } from '../common/geo';
import { unsignedPaiseSchema } from '../common/money';
import { commissionBandSchema, jobStatusSchema } from '../fleet/jobs';
import { vehicleClassSchema } from '../fleet/trucks';

/**
 * §6.3's job offer and the job a driver has accepted (Phase 17, §9.2.2, §16.3).
 *
 * TWO SHAPES, ONE JOB. An OFFER is a time-boxed proposition the driver may
 * decline and which several drivers may hold in sequence; an ASSIGNED JOB is
 * theirs. They share most fields and are deliberately separate types, because
 * the offer carries a countdown and no customer phone number, and the assigned
 * job carries a phone number and no countdown.
 */

/**
 * What the driver is actually paid, spelled out (§9.2.2's AC).
 *
 * TowPartner's offer card shows ONE unqualified fare number today, which is the
 * gross — so a driver reading it is over-estimating their earnings by the
 * commission, every time. §3.3 takes 5–10 % depending on band, and a driver
 * deciding in twenty seconds has to be deciding on the net.
 *
 * All three travel together and the server computes them from the values LOCKED
 * on the booking at confirm (§3.4), never from live config: an admin editing the
 * rate card mid-search must not change what a driver was offered.
 */
export const jobEarningsSchema = z.object({
  /** The customer's total. What the job is worth before we take our share. */
  grossPaise: unsignedPaiseSchema,
  /** §3.3's tier — a label, and the reason the percentage is what it is. */
  band: commissionBandSchema.nullable(),
  /** The locked percentage, e.g. 8.00. Shown so the deduction is explicable, not just applied. */
  commissionPct: z.number().nullable(),
  commissionPaise: unsignedPaiseSchema,
  /** `gross - commission`. The number the driver is deciding on. */
  netPaise: unsignedPaiseSchema,
});
export type JobEarnings = z.infer<typeof jobEarningsSchema>;

/** The trip, as either an offer or an assignment describes it. */
const jobLegSchema = z.object({
  pickup: geoPointSchema,
  pickupAddress: z.string().nullable(),
  drop: geoPointSchema.nullable(),
  dropAddress: z.string().nullable(),
  /** Road distance of the trip itself — NOT the driver's distance to the pickup. */
  distanceKm: z.number().nullable(),
});

/**
 * §6.3's offer. Delivered over the `/driver` socket AND as a high-priority push,
 * because a driver whose app is backgrounded in Doze has no socket and twenty
 * seconds is not long enough to wait for one.
 */
export const jobOfferSchema = z.object({
  /** The booking. `POST /v1/jobs/:id/{accept,reject}` takes this id. */
  bookingId: z.uuid(),
  reference: z.string(),
  serviceType: serviceTypeSchema,
  vehicleClass: vehicleClassSchema,

  /**
   * ABSOLUTE, ON THE SERVER'S CLOCK — never a relative "expires in N seconds".
   *
   * A relative countdown is extended by every second of network latency and by
   * any clock the handset feels like keeping, so a lagging client would hold an
   * offer open after the server had already expired it and re-offered the job to
   * someone else. Two drivers then believe they have twenty seconds on the same
   * booking. The client renders `expiresAt - now` and lets it go negative rather
   * than trusting its own start time.
   */
  expiresAt: z.iso.datetime(),

  /** The whole point of the card (§9.2.2). */
  earnings: jobEarningsSchema,

  ...jobLegSchema.shape,

  /** Straight-line metres from the driver's last fix to the pickup, at offer time. */
  distanceToPickupMeters: z.number().nonnegative(),

  /**
   * §9.2.2's AC — the driver sees who they are collecting for before accepting.
   * `null` for a customer nobody has rated yet, which is honest; a default of
   * 5.0 would advertise a rating that does not exist.
   */
  customerRating: z.number().nullable(),
  /** First name only. Full contact details arrive with the assignment, not the offer. */
  customerName: z.string().nullable(),
  /** §9.1.5's note editor, so a driver can decline something they cannot carry. */
  note: z.string().nullable(),

  /** Which wave produced this offer. Shown to nobody; carried for support and analytics. */
  wave: z.number().int().positive(),
});
export type JobOffer = z.infer<typeof jobOfferSchema>;

/**
 * `GET /v1/driver/offers/current` — the §19.2 resync.
 *
 * A socket frame is not a durable delivery: a driver whose connection dropped
 * during the twenty seconds would otherwise never see the offer at all, and the
 * push may have been suppressed by the OS. `null` means nothing is pending,
 * which is the overwhelmingly common answer and must not be an error.
 */
export const currentOfferResponseSchema = z.object({
  offer: jobOfferSchema.nullable(),
});
export type CurrentOfferResponse = z.infer<typeof currentOfferResponseSchema>;

/**
 * A job the driver has accepted.
 *
 * Carries the customer's number, which the offer deliberately does not: §11.9's
 * reasoning in the other direction — contact details are earned by assignment,
 * not by being considered.
 */
export const driverJobSchema = z.object({
  bookingId: z.uuid(),
  reference: z.string(),
  status: jobStatusSchema,
  serviceType: serviceTypeSchema,
  vehicleClass: vehicleClassSchema,

  earnings: jobEarningsSchema,
  ...jobLegSchema.shape,

  customerName: z.string().nullable(),
  /** E.164. Phase 18 replaces this with a masked number once telephony exists. */
  customerMobile: z.string().nullable(),
  customerRating: z.number().nullable(),
  note: z.string().nullable(),

  /**
   * §5.1's collection OTP is held by the CUSTOMER and typed by the driver. This
   * flag says only whether the handover step is reachable yet — the code itself
   * never travels to the driver's phone.
   */
  otpPending: z.boolean(),
  assignedAt: z.iso.datetime().nullable(),

  /**
   * §5.2's instants, ABSOLUTE and on the server's clock — the same rule
   * `expiresAt` follows above, for the same reason.
   *
   * `arrivedAt` is what the waiting ticker counts from. A relative
   * "waiting for N minutes" would drift by every second of latency and by
   * whatever clock the handset keeps, and unlike a countdown this one is
   * BILLABLE: the number on the driver's screen has to be the number the
   * finalizer charges.
   */
  arrivedAt: z.iso.datetime().nullable(),
  startedAt: z.iso.datetime().nullable(),

  /**
   * §7.4's waiting rules as LOCKED on this booking (§3.4), not as currently
   * configured. Sent so the handset can render an accruing charge that matches
   * what `complete` will bill to the paisa — the app must never carry its own
   * copy of a rate the admin can edit.
   */
  waiting: z.object({
    freeMinutes: z.number().int().nonnegative(),
    perMinutePaise: unsignedPaiseSchema,
  }),

  /**
   * Seconds to the ACTIVE leg's destination: the pickup before `in_progress`,
   * the drop after. `null` when no route has been computed — the ETA engine
   * runs once at assignment and a Directions failure is a legitimate outcome
   * (§19.2), not an error to hide behind a fabricated number.
   */
  etaSeconds: z.number().int().nonnegative().nullable(),

  /**
   * §11.4's route line, as an encoded Google polyline. Two legs so the driver's
   * map can switch target at `in_progress` without a second billable call.
   */
  routePolyline: z.string().nullable(),
  routeDropPolyline: z.string().nullable(),
});
export type DriverJob = z.infer<typeof driverJobSchema>;

/** `GET /v1/driver/jobs/current` — `null` when the driver is idle. */
export const currentJobResponseSchema = z.object({
  job: driverJobSchema.nullable(),
});
export type CurrentJobResponse = z.infer<typeof currentJobResponseSchema>;

/**
 * `POST /v1/jobs/:id/accept`.
 *
 * Empty body. Everything the server needs is the booking id and the caller's
 * token — and an accept that carried, say, an expected fare would invite a
 * client to disagree with the server about what it was offered.
 */
export const jobAcceptSchema = z.object({});
export type JobAccept = z.infer<typeof jobAcceptSchema>;

export const jobAcceptResponseSchema = z.object({
  job: driverJobSchema,
});
export type JobAcceptResponse = z.infer<typeof jobAcceptResponseSchema>;

/** `POST /v1/jobs/:id/reject`. A reason is optional and is not shown to the customer. */
export const jobRejectSchema = z.object({
  reason: z.string().max(200).optional(),
});
export type JobReject = z.infer<typeof jobRejectSchema>;

/**
 * §5.2's execution chain (Phase 18): `arrived → otp_verified(started) → completed`,
 * with `unable_to_deliver` as the branch out.
 *
 * ALL FOUR RETURN THE WHOLE `DriverJob`, not a status string. The screen has to
 * re-render against the server's view anyway — waiting charges start accruing at
 * `arrived`, the ETA target flips at `start`, the earnings change at `complete` —
 * and returning a partial forces a refetch the mutation could have avoided.
 */
export const jobArrivedSchema = z.object({});
export type JobArrived = z.infer<typeof jobArrivedSchema>;

/**
 * §9.2.3's "job cannot start without a valid OTP".
 *
 * The six digits the CUSTOMER reads off their tracking screen. Compared against
 * `bookings.booking_otp_hash`; a mismatch, an expired window and an exhausted
 * attempt counter are all one indistinguishable refusal, because a caller able
 * to tell them apart is an oracle for a six-digit space.
 */
export const jobStartSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'A booking OTP is six digits'),
});
export type JobStart = z.infer<typeof jobStartSchema>;

export const jobCompleteSchema = z.object({});
export type JobComplete = z.infer<typeof jobCompleteSchema>;

/**
 * §3.5's "unable to deliver" reasons, which §9.2.3 names verbatim.
 *
 * An ENUM, not free text. This branch never charges the customer, counts against
 * `drivers.completion_rate` and triggers §6.5 re-dispatch — three consequences
 * that ops has to be able to aggregate. A free-text field would make "customer
 * unavailable" and "cust not there" different reasons forever.
 */
export const jobUnableReasonSchema = z.enum([
  'customer_unavailable',
  'wrong_address',
  'customer_refused',
  'vehicle_inaccessible',
  'unsafe_conditions',
  'breakdown',
]);
export type JobUnableReason = z.infer<typeof jobUnableReasonSchema>;

export const jobUnableSchema = z.object({
  reason: jobUnableReasonSchema,
  /** Optional colour for ops. Never shown to the customer. */
  note: z.string().max(500).optional(),
});
export type JobUnable = z.infer<typeof jobUnableSchema>;

/** Every §5.2 transition answers with the job as it now stands. */
export const jobTransitionResponseSchema = z.object({
  job: driverJobSchema,
});
export type JobTransitionResponse = z.infer<typeof jobTransitionResponseSchema>;

/**
 * `unable` is the one that does NOT answer with a job — the driver no longer has
 * one. The booking has gone back to `searching` and been handed to §6.5.
 */
export const jobUnableResponseSchema = z.object({
  bookingId: z.uuid(),
  redispatched: z.boolean(),
});
export type JobUnableResponse = z.infer<typeof jobUnableResponseSchema>;

/**
 * `GET /v1/jobs/:id/contact` (driver) and `GET /v1/bookings/:id/contact`
 * (customer) — §9.1.7 / §9.2.3's call button, behind `TelephonyPort`.
 *
 * `masked: false` MEANS THE REAL NUMBER IS IN THIS RESPONSE, and the client is
 * required to say so before dialling. No masked-calling provider is provisioned
 * (SETUP-CHECKLIST item 13), so the direct-dial adapter is the live path and
 * both apps show a privacy warning. Shipping the flag rather than two different
 * response shapes means the app cannot forget to check.
 */
export const callContactSchema = z.object({
  /** E.164. Either a provider-issued proxy number or, today, the real one. */
  dialNumber: z.string().nullable(),
  masked: z.boolean(),
  /** Whose number this is, for the app's own labelling. */
  party: z.enum(['customer', 'driver']),
  displayName: z.string().nullable(),
  /** Present only on a masked call, for provider-side correlation. */
  reference: z.string().nullable(),
});
export type CallContact = z.infer<typeof callContactSchema>;
