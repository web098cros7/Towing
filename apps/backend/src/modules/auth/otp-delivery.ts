import { eq } from 'drizzle-orm';
import type { Database } from '../../db/db.module';
import { otpVerifications } from '../../db/schema';
import type { OtpPort, OtpPurpose } from './otp.port';
import { digest, digestsMatch } from './otp.util';

/**
 * The two OTP steps every login shares (customer and driver apps, fleet console,
 * admin console), so none of them needs to know WHO made the code.
 *
 * We make it (dev log, MSG91 Flow SMS): only its digest is stored, and the typed
 * code is checked against that digest.
 *
 * The vendor makes it (MSG91's OTP Widget): the vendor's reference is stored on
 * the same row and the vendor is asked. The challenge, the attempt cap and the
 * expiry stay ours either way: the callers increment `attempts` before calling
 * `otpMatches`, exactly as before.
 */
export async function deliverOtp(
  db: Database,
  otp: OtpPort,
  row: { id: string; phone: string; code: string; purpose: OtpPurpose },
): Promise<void> {
  const receipt = await otp.send(row.phone, row.code, row.purpose);
  if (receipt?.vendorRef) {
    await db
      .update(otpVerifications)
      .set({ vendorRef: receipt.vendorRef })
      .where(eq(otpVerifications.id, row.id));
  }
}

export async function otpMatches(
  otp: OtpPort,
  row: { codeHash: string; vendorRef: string | null },
  attempt: string,
): Promise<boolean> {
  if (row.vendorRef) {
    // Made by a vendor: only the vendor can say. A row with a vendor reference
    // but an adapter that cannot verify (the provider was switched mid-login)
    // is refused rather than checked against a digest of a code we never made.
    return otp.verify ? otp.verify(row.vendorRef, attempt) : false;
  }
  return digestsMatch(row.codeHash, digest(attempt));
}
