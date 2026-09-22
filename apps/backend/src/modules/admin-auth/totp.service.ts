import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { generate, generateSecret, generateURI } from 'otplib';
import { ENV, type Env } from '../../config/env';

/** TOTP step in seconds (RFC 6238 default — what every authenticator app uses). */
export const TOTP_STEP_SECONDS = 30;
/** Acceptance window: ±1 step, as the W2 acceptance criterion requires. */
const TOTP_WINDOW_STEPS = 1;
/** Bytes of entropy in a recovery code: 6 → 8 base64url chars, single-use. */
export const RECOVERY_CODE_BYTES = 6;
export const RECOVERY_CODE_COUNT = 10;

/**
 * TOTP primitives for admin two-factor (W2). Pure crypto — no DB, no HTTP —
 * so the flows in `AdminAuthService` stay readable and this file is unit
 * testable without a database.
 *
 * Two deliberate choices against the library defaults:
 *
 * 1. The ±1-step window is implemented HERE with explicit per-step epochs
 *    rather than `verify(..., { epochTolerance })`: the tolerance option's
 *    boundary semantics did not accept adjacent-step codes when probed, while
 *    same-epoch generate-then-verify round-trips exactly. Three HMACs per
 *    verification is trivial on a 5/min-bucketed route, and the comparison is
 *    `timingSafeEqual`, so nothing about WHICH step matched leaks.
 * 2. Secrets rest encrypted (AES-256-GCM, key = SHA-256 of a domain string +
 *    `ADMIN_TOTP_ENC_KEY`): a database dump must not hand out second factors.
 */
@Injectable()
export class TotpService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Fresh base32 secret for an enrolment. */
  generateSecret(): string {
    return generateSecret();
  }

  /** The `otpauth://` URI the API returns; the WEB renders the QR from it. */
  otpauthUri(email: string, secret: string): string {
    return generateURI({ issuer: 'Towing Admin', label: email, secret });
  }

  /**
   * Checks `code` against steps −1, 0, +1 around now.
   *
   * Epochs are SECONDS — the library documents `epoch` as "unix epoch in
   * seconds", and passing milliseconds silently mints codes ~2M steps in the
   * future while shrinking the replay counter to a 30 ms granularity (a login
   * in the same 30 ms slice as confirm then looks like a replay). Do not
   * "simplify" this back to `Date.now()`.
   *
   * @returns the matched counter (`floor(epochSec / 30)`, int4 for millennia)
   * for replay bookkeeping, or null when nothing matched.
   */
  async verifyCode(secret: string, code: string): Promise<number | null> {
    if (!/^\d{6}$/.test(code)) return null;
    const nowSec = Math.floor(Date.now() / 1000);

    for (let delta = -TOTP_WINDOW_STEPS; delta <= TOTP_WINDOW_STEPS; delta += 1) {
      const epoch = nowSec + delta * TOTP_STEP_SECONDS;
      let expected: string;
      try {
        expected = await generate({ secret, epoch });
      } catch {
        return null;
      }
      const left = Buffer.from(expected, 'utf8');
      const right = Buffer.from(code, 'utf8');
      if (left.length === right.length && timingSafeEqual(left, right)) {
        return Math.floor(epoch / TOTP_STEP_SECONDS);
      }
    }

    return null;
  }

  /** `iv:ciphertext:tag`, all base64url. Throws on tampering (GCM auth). */
  encryptSecret(plain: string): string {
    const key = encKey(this.env.ADMIN_TOTP_ENC_KEY);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join(':');
  }

  decryptSecret(enc: string): string {
    const [ivB64, ctB64, tagB64] = enc.split(':');
    if (!ivB64 || !ctB64 || !tagB64) throw new Error('malformed encrypted secret');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encKey(this.env.ADMIN_TOTP_ENC_KEY),
      Buffer.from(ivB64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Fresh recovery codes (plaintext, shown once) with their hashes. */
  generateRecoveryCodes(): Array<{ code: string; codeHash: string }> {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const code = randomBytes(RECOVERY_CODE_BYTES).toString('base64url');
      return { code, codeHash: hashRecoveryCode(code) };
    });
  }
}

/** SHA-256 of a recovery code — same standing as the OTP digests. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function encKey(configured: string): Buffer {
  return createHash('sha256').update(`admin-totp-enc-v1:${configured}`).digest();
}
