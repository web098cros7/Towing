import type { otpPurposeEnum } from '../../db/schema';

export type OtpPurpose = (typeof otpPurposeEnum.enumValues)[number];

/**
 * Outbound one-time-code delivery. A port rather than a direct SMS client so the
 * login flow can be exercised end to end in tests and local dev without an SMS
 * account; the production adapter (MSG91/Twilio) drops in behind the same token.
 */
/** What a send returns when the VENDOR made the code (MSG91's OTP Widget). */
export interface OtpSendReceipt {
  /** The vendor's id for this code; `verify` is asked about it later. */
  vendorRef: string;
}

export interface OtpPort {
  /**
   * Deliver a login code. Adapters that deliver OUR code return nothing. An adapter whose vendor makes its own code (the OTP Widget)
   * ignores `code` and returns the vendor's reference: the typed code is then
   * checked by `verify`, never against our hash.
   */
  send(phone: string, code: string, purpose: OtpPurpose): Promise<OtpSendReceipt | void>;

  /** Whether `code` is right for the vendor-made code `vendorRef`. Only vendor-code adapters have it. */
  verify?(vendorRef: string, code: string): Promise<boolean>;

  /**
   * The code most recently issued to this number, if the adapter can say.
   *
   * OPTIONAL on purpose: a real SMS gateway cannot answer this and simply does
   * not implement it. Only the development adapter does, and only so a
   * mocks-off browser test can complete the two-step login without scraping the
   * server's log. Reaching it requires `AUTH_DEV_OTP_ECHO`, which
   * `assertProductionSafety` refuses to boot with.
   */
  lastIssued?(phone: string): Promise<string | null>;
}

/** DI token — the concrete adapter is chosen per environment in AuthModule. */
export const OTP_PORT = Symbol('OTP_PORT');
