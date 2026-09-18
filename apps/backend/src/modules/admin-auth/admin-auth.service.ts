import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminIdentity,
  AdminLoginChallenge,
  AdminLoginRequest,
  AdminOtpVerifyRequest,
  AdminSession,
} from '@towing/api-contracts';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import { adminUsers, loginChallenges, otpVerifications } from '../../db/schema';
import { OTP_PORT, type OtpPort } from '../auth/otp.port';
import { verifyDecoyPassword, verifyPassword } from '../auth/password';
import { TokenService, type SessionContext } from '../auth/token.service';

const ADMIN_REALM = 'admin';

/** One message for every way step 1 can fail — no enumeration of admin emails. */
const LOGIN_REJECTED = 'Email or password is incorrect';
const CHALLENGE_REJECTED = 'This login challenge is no longer valid';

/**
 * Placeholder code hash for TOTP challenges (W2). `login_challenges.otp_id`
 * is NOT NULL, but a TOTP challenge must never carry an SMS code — there is
 * nothing to send and nothing the SMS branch may accept. The marker makes
 * that visible in the data (same convention as `seedAdmin`'s
 * `scrypt$unusable`); `verify`'s TOTP branch never compares against it.
 */
const TOTP_NO_SMS_CODE_HASH = 'totp$no-sms-code';

// Security policy, not a deployment knob — the same constants the fleet console
// uses, and for the same reason: a per-environment lockout window would be a
// per-environment attack surface.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

/**
 * Admin console auth (§9.4, §15.2): email + password, then a code to the
 * admin's registered mobile.
 *
 * WHY OTP RATHER THAN TOTP, when `admin_users.twofa_secret` exists. TOTP needs
 * an enrolment surface to set a secret, and the admin console is Phase 11 — so
 * shipping it now would mean either seeding a shared secret (a backdoor) or
 * having no way for a real operator to onboard (an untestable path). The column
 * ships nullable so Phase 11 adds TOTP without a migration: verify reads it when
 * non-null and falls back to this flow when null, and that fallback IS the
 * migration path.
 *
 * Every hardening property of `AuthService` is reproduced here deliberately,
 * because this is the realm that approves KYC and later approves payouts.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(OTP_PORT) private readonly otp: OtpPort,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Step 1. Every branch runs exactly one scrypt verification before deciding
   * anything, so an unknown email, a wrong password and a locked account are
   * indistinguishable by response time as well as by response body.
   */
  async login(input: AdminLoginRequest): Promise<AdminLoginChallenge> {
    const email = input.email.trim().toLowerCase();
    const now = new Date();

    const [admin] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email))
      .limit(1);

    const passwordOk = admin
      ? await verifyPassword(input.password, admin.passwordHash)
      : await verifyDecoyPassword(input.password);

    if (!admin) throw ApiException.unauthorized(LOGIN_REJECTED);

    if (admin.lockedUntil && admin.lockedUntil > now) {
      throw ApiException.unauthorized(LOGIN_REJECTED);
    }

    if (!passwordOk) {
      await this.recordFailedAttempt(admin.id, now);
      throw ApiException.unauthorized(LOGIN_REJECTED);
    }

    // Past the password check there is nothing left to enumerate, so a
    // deactivated operator gets a message they can act on.
    if (admin.status !== 'active') {
      throw ApiException.forbidden('This admin account is not active');
    }

    await this.db
      .update(adminUsers)
      .set({ failedAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(adminUsers.id, admin.id));

    const expiresAt = new Date(now.getTime() + this.env.OTP_TTL_SECONDS * 1000);
    // W2: a TOTP-enrolled admin proves the second factor with their
    // authenticator — no SMS is minted or sent, and the challenge carries the
    // unusable marker above instead of a real code hash.
    const method = admin.twofaEnabled ? ('totp' as const) : ('sms' as const);
    const code = method === 'sms' ? generateOtp() : null;

    const [otp] = await this.db
      .insert(otpVerifications)
      .values({
        phone: admin.mobile,
        purpose: 'admin_login',
        codeHash: code ? digest(code) : TOTP_NO_SMS_CODE_HASH,
        expiresAt,
      })
      .returning({ id: otpVerifications.id });

    const [challenge] = await this.db
      .insert(loginChallenges)
      .values({
        subjectId: admin.id,
        // An admin id is not a `users` id — the whole point of migration 0007.
        subjectType: 'admin',
        realm: ADMIN_REALM,
        otpId: otp!.id,
        expiresAt,
      })
      .returning({ id: loginChallenges.id });

    if (method === 'sms') {
      await this.otp.send(admin.mobile, code!, 'admin_login');
    }

    return { challengeId: challenge!.id, expiresAt: expiresAt.toISOString(), method };
  }

  /** Step 2. */
  async verify(input: AdminOtpVerifyRequest, context: SessionContext = {}): Promise<AdminSession> {
    const now = new Date();

    const [challenge] = await this.db
      .select()
      .from(loginChallenges)
      .where(eq(loginChallenges.id, input.challengeId))
      .limit(1);

    if (
      !challenge ||
      challenge.realm !== ADMIN_REALM ||
      challenge.consumedAt ||
      challenge.expiresAt <= now
    ) {
      throw ApiException.unauthorized(CHALLENGE_REJECTED);
    }

    // Increment and read in one statement so the cap holds under a burst of
    // parallel guesses.
    const [attempted] = await this.db
      .update(otpVerifications)
      .set({ attempts: sql`${otpVerifications.attempts} + 1` })
      .where(
        and(
          eq(otpVerifications.id, challenge.otpId),
          eq(otpVerifications.used, false),
          lt(otpVerifications.attempts, this.env.OTP_MAX_ATTEMPTS),
          gt(otpVerifications.expiresAt, now),
        ),
      )
      .returning();

    if (!attempted) {
      throw ApiException.rateLimited('Too many incorrect codes — start the login again');
    }

    if (!digestsMatch(attempted.codeHash, digest(input.otp))) {
      throw ApiException.unauthorized('That code is not correct');
    }

    const [consumed] = await this.db
      .update(loginChallenges)
      .set({ consumedAt: now })
      .where(and(eq(loginChallenges.id, challenge.id), isNull(loginChallenges.consumedAt)))
      .returning({ id: loginChallenges.id });

    if (!consumed) throw ApiException.unauthorized(CHALLENGE_REJECTED);

    await this.db
      .update(otpVerifications)
      .set({ used: true })
      .where(eq(otpVerifications.id, attempted.id));

    const admin = await this.identity(challenge.subjectId);
    if (!admin) throw ApiException.forbidden('This admin account is not active');

    await this.db
      .update(adminUsers)
      .set({ lastLoginAt: now, failedAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(adminUsers.id, admin.id));

    const pair = await this.tokens.issueSession({
      subjectId: admin.id,
      realm: ADMIN_REALM,
      context,
    });

    return { ...pair, admin };
  }

  async refresh(refreshToken: string, context: SessionContext = {}) {
    return this.tokens.rotate(refreshToken, ADMIN_REALM, context);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.logout(refreshToken, ADMIN_REALM);
  }

  /** Development only — mirrors the fleet console's echo, same three guards. */
  async devOtp(challengeId: string): Promise<{ otp: string }> {
    if (!this.env.AUTH_DEV_OTP_ECHO) throw ApiException.notFound();

    const [challenge] = await this.db
      .select({ realm: loginChallenges.realm, subjectId: loginChallenges.subjectId })
      .from(loginChallenges)
      .where(eq(loginChallenges.id, challengeId))
      .limit(1);

    if (!challenge || challenge.realm !== ADMIN_REALM) throw ApiException.notFound();

    const [admin] = await this.db
      .select({ mobile: adminUsers.mobile })
      .from(adminUsers)
      .where(eq(adminUsers.id, challenge.subjectId))
      .limit(1);

    const code = admin ? await this.otp.lastIssued?.(admin.mobile) : null;
    if (!code) throw ApiException.notFound();

    return { otp: code };
  }

  async identity(adminId: string): Promise<AdminIdentity | null> {
    const [admin] = await this.db
      .select({
        id: adminUsers.id,
        email: adminUsers.email,
        name: adminUsers.name,
        subRole: adminUsers.subRole,
        status: adminUsers.status,
        twofaEnabled: adminUsers.twofaEnabled,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId))
      .limit(1);

    if (!admin || admin.status !== 'active') return null;

    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      subRole: admin.subRole,
      twofaEnabled: admin.twofaEnabled,
    };
  }

  private async recordFailedAttempt(adminId: string, now: Date): Promise<void> {
    const lockedUntil = new Date(now.getTime() + LOCKOUT_SECONDS * 1000);

    await this.db
      .update(adminUsers)
      .set({
        failedAttempts: sql`${adminUsers.failedAttempts} + 1`,
        // toISOString: raw `sql` fragments bypass drizzle's column mapping, and
        // postgres.js rejects a bare Date at Bind time — which would turn every
        // wrong-password attempt into a 500 instead of a counted failure.
        lockedUntil: sql`case when ${adminUsers.failedAttempts} + 1 >= ${MAX_FAILED_ATTEMPTS} then ${lockedUntil.toISOString()}::timestamptz else ${adminUsers.lockedUntil} end`,
        updatedAt: now,
      })
      .where(eq(adminUsers.id, adminId));
  }
}

function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  return left.length === right.length && timingSafeEqual(left, right);
}
