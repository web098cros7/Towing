/**
 * Masked calling (§9.1.7's "call/chat", §9.2.3's "call/chat") — Phase 18.
 *
 * ABSENT FROM §16.2's INTEGRATION LIST, and added here deliberately. The spec
 * assumes the two parties can reach each other and never says how; every
 * comparable marketplace does it through a proxy number, and doing it any other
 * way means publishing a customer's personal mobile to every driver who is
 * offered their job and a driver's to every customer. §20.4's privacy commitment
 * does not survive that.
 *
 * WHAT A MASKED CALL ACTUALLY IS, since the shape of this port follows from it:
 * the provider (Exotel in India) holds a pool of DIDs, binds one to the pair
 * (customer, driver) for the life of the trip, and bridges the two legs. Neither
 * party ever sees the other's number; both see the DID. So the port's job is not
 * "place a call" — the handset does that — it is "give me a number this handset
 * can dial that will reach the other party".
 *
 * WHICH IS WHY IT RETURNS `masked: false` RATHER THAN THROWING when no provider
 * is configured. `MaskedCall` is a single shape with a flag, not two response
 * types, because the client has to be able to tell the difference and a client
 * that has to catch an error to discover it will eventually forget to. With the
 * flag, the privacy warning is a branch on a boolean that TypeScript makes
 * visible; without it, the honest and dishonest paths look identical at the call
 * site.
 *
 * NO PROVIDER ACCOUNT EXISTS — SETUP-CHECKLIST item 13, open since Phase 16 was
 * told to start it. `DirectDialAdapter` is the live default, production refuses
 * to boot on it, and `ToBeDoneEhsan.md` records that real numbers are exposed
 * until an account is created.
 */
export interface MaskedCall {
  /**
   * The number this handset should dial, E.164. A provider DID when masking is
   * live; the other party's real number when it is not; `null` when there is no
   * number at all (a customer who booked for someone else and gave no contact).
   */
  dialNumber: string | null;
  /**
   * FALSE MEANS `dialNumber` IS A REAL PERSONAL NUMBER. The caller is required
   * to say so before dialling — see `callContactSchema` in the contracts, whose
   * `masked` field this becomes.
   */
  masked: boolean;
  /**
   * Provider-side correlation id for the binding, for support and for teardown.
   * `null` on the direct path, where there is no binding to correlate.
   */
  reference: string | null;
}

export interface MaskCallParams {
  /** The booking the call belongs to. Bindings are scoped to a trip, never to a pair of people. */
  bookingId: string;
  /** Who is dialling — decides which leg is which. */
  from: 'customer' | 'driver';
  /** E.164 numbers for both parties. Either may be null. */
  customerMobile: string | null;
  driverMobile: string | null;
}

export interface TelephonyPort {
  /**
   * Get a dialable number for this leg of this booking.
   *
   * Never throws for a provider outage. §19.2's ladder applies: a masked call is
   * better than a direct one, and a direct one is far better than a customer
   * standing beside a broken vehicle who cannot reach the driver who is looking
   * for them. The router degrades and the `masked` flag tells the truth.
   */
  maskedNumber(params: MaskCallParams): Promise<MaskedCall>;
}

export const TELEPHONY = Symbol('TELEPHONY');
