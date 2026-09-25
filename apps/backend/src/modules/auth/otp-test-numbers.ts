import type { OtpPort, OtpPurpose, OtpSendReceipt } from './otp.port';

/**
 * Sends test numbers' codes through the dev adapter (log + on-screen echo) and
 * everyone else's through the real one (`OTP_TEST_NUMBERS`).
 *
 * Why: the truck simulator logs in as the seeded demo drivers, whose numbers
 * (`+919845100003`…) are real-looking numbers owned by strangers. With a real
 * SMS provider on, every simulator login would text them. A vendor-made code
 * is recognised by its `vendorRef`, so `verify` only ever sees real-provider
 * codes and a test number's code is checked against our digest as usual.
 */
export class TestNumberOtpRouter implements OtpPort {
  private readonly testNumbers: ReadonlySet<string>;

  constructor(
    private readonly dev: OtpPort,
    private readonly real: OtpPort,
    testNumbers: readonly string[],
  ) {
    this.testNumbers = new Set(testNumbers);
    if (real.verify) this.verify = (ref, code) => real.verify!(ref, code);
  }

  verify?: (vendorRef: string, code: string) => Promise<boolean>;

  send(phone: string, code: string, purpose: OtpPurpose): Promise<OtpSendReceipt | void> {
    return this.testNumbers.has(phone)
      ? this.dev.send(phone, code, purpose)
      : this.real.send(phone, code, purpose);
  }

  async lastIssued(phone: string): Promise<string | null> {
    const port = this.testNumbers.has(phone) ? this.dev : this.real;
    return (await port.lastIssued?.(phone)) ?? null;
  }
}
