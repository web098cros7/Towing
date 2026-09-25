import { Inject, Injectable } from '@nestjs/common';
import type {
  FleetLoginRequest,
  FleetOtpVerifyRequest,
  FleetSession,
} from '@towing/api-contracts';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import {
  fleetOwnerCredentials,
  fleets,
  loginChallenges,
  otpVerifications,
  users,
} from '../../db/schema';
import { FLEET_REALM } from './auth.types';
import { OTP_PORT, type OtpPort } from './otp.port';
import { verifyDecoyPassword, verifyPassword } from './password';
import { TokenService, type SessionContext } from './token.service';
import { deliverOtp, otpMatches } from './otp-delivery';
import { digest, generateOtp } from './otp.util';

/**
 * One message for every way step 1 can fail. "No such account", "wrong password"
 * and "locked" are all the same string so the endpoint cannot be walked to
 * enumerate which emails have fleet accounts (§16.4).
 */
const LOGIN_REJECTED = 'Email or password is incorrect';

/** Second-factor failures are equally uninformative — the challenge id is opaque. */
const CHALLENGE_REJECTED = 'This login challenge is no longer valid';

// Not env-configurable: these are a security policy, not a deployment knob, and
// a per-environment lockout window would be a per-environment attack surface.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(OTP_PORT) private readonly otp: OtpPort,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Step 1 of §16.4: email + password produces a challenge, never a session.
   *
   * Every branch below runs exactly one scrypt verification before deciding
   * anything, so an unknown email, a wrong password and a locked account are
   * indistinguishable by response time as well as by response body.
   */
  async login(input: FleetLoginRequest): Promise<{ challengeId: string; expiresAt: string }> {
    const email = input.email.trim().toLowerCase();
    const now = new Date();

    const [row] = await this.db
      .select({ credential: fleetOwnerCredentials, user: users })
      .from(fleetOwnerCredentials)
      .innerJoin(users, eq(users.id, fleetOwnerCredentials.userId))
      .where(eq(fleetOwnerCredentials.email, email))
      .limit(1);

    const passwordOk = row
      ? await verifyPassword(input.password, row.credential.passwordHash)
      : await verifyDecoyPassword(input.password);

    if (!row) throw ApiException.unauthorized(LOGIN_REJECTED);

    const { credential, user } = row;

    if (credential.lockedUntil && credential.lockedUntil > now) {
      throw ApiException.unauthorized(LOGIN_REJECTED);
    }

    if (!passwordOk) {
      await this.recordFailedAttempt(credential.id, now);
      throw ApiException.unauthorized(LOGIN_REJECTED);
    }

    const fleet = await this.fleetOwnedBy(user.id);
    if (!fleet) throw ApiException.unauthorized(LOGIN_REJECTED);
    // Past the password check there is nothing left to enumerate, so a suspended
    // fleet gets a message its owner can act on.
    if (fleet.status === 'suspended') {
      throw ApiException.forbidden('This fleet account is suspended');
    }

    await this.db
      .update(fleetOwnerCredentials)
      .set({ failedAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(fleetOwnerCredentials.id, credential.id));

    const expiresAt = new Date(now.getTime() + this.env.OTP_TTL_SECONDS * 1000);
    const code = generateOtp();

    // Only the digest is stored. SHA-256 without a work factor is deliberate: a
    // 6-digit code has ~20 bits of entropy, so no KDF cost would meaningfully
    // slow an offline search. What protects it is the attempt cap plus the TTL
    // enforced in `verify()`, not the strength of the hash.
    // The `!` on these two: a single-row INSERT ... RETURNING yields exactly one
    // row, but the driver types every result as an array.
    const [otp] = await this.db
      .insert(otpVerifications)
      .values({
        phone: user.mobile,
        purpose: 'fleet_login',
        codeHash: digest(code),
        expiresAt,
      })
      .returning({ id: otpVerifications.id });

    // `subjectType: 'user'` — a fleet owner IS a row in `users`. Drivers and
    // admins live in their own tables, which is why the column has no FK
    // (migration 0007; see `driver-login-challenge.e2e.spec.ts`).
    const [challenge] = await this.db
      .insert(loginChallenges)
      .values({
        subjectId: user.id,
        subjectType: 'user',
        realm: FLEET_REALM,
        otpId: otp!.id,
        expiresAt,
      })
      .returning({ id: loginChallenges.id });

    await deliverOtp(this.db, this.otp, {
      id: otp!.id,
      phone: user.mobile,
      code,
      purpose: 'fleet_login',
    });

    return { challengeId: challenge!.id, expiresAt: expiresAt.toISOString() };
  }

  /**
   * DEVELOPMENT ONLY — the code just issued for a challenge.
   *
   * Exists so a mocks-off Playwright run can complete the two-step login; the
   * alternative was scraping the server's log from a browser test. Guarded
   * three ways: the route 404s unless `AUTH_DEV_OTP_ECHO` is set, the adapter
   * only records anything under the same flag, and `assertProductionSafety`
   * refuses to boot production with it on.
   *
   * KEYED ON THE CHALLENGE, NOT THE PHONE NUMBER. A challenge only exists once
   * someone has passed step 1 with valid credentials, so this cannot be used to
   * harvest a code for an arbitrary number — it can only reveal a code to
   * someone who has already proved they own the password.
   */
  async devOtp(challengeId: string): Promise<{ otp: string }> {
    if (!this.env.AUTH_DEV_OTP_ECHO) throw ApiException.notFound();

    const [challenge] = await this.db
      .select({ subjectId: loginChallenges.subjectId, realm: loginChallenges.realm })
      .from(loginChallenges)
      .where(eq(loginChallenges.id, challengeId))
      .limit(1);

    if (!challenge || challenge.realm !== FLEET_REALM) throw ApiException.notFound();

    const [user] = await this.db
      .select({ mobile: users.mobile })
      .from(users)
      .where(eq(users.id, challenge.subjectId))
      .limit(1);

    const code = user ? await this.otp.lastIssued?.(user.mobile) : null;
    if (!code) throw ApiException.notFound();

    return { otp: code };
  }

  /** Step 2 of §16.4: challenge + code becomes a session. */
  async verify(input: FleetOtpVerifyRequest, context: SessionContext = {}): Promise<FleetSession> {
    const now = new Date();

    const [challenge] = await this.db
      .select()
      .from(loginChallenges)
      .where(eq(loginChallenges.id, input.challengeId))
      .limit(1);

    if (
      !challenge ||
      challenge.realm !== FLEET_REALM ||
      challenge.consumedAt ||
      challenge.expiresAt <= now
    ) {
      throw ApiException.unauthorized(CHALLENGE_REJECTED);
    }

    // Counting the attempt in the same statement that reads the row means a
    // burst of parallel guesses cannot all read `attempts` before any of them
    // writes it — the cap holds under concurrency, which is the only condition
    // under which brute-forcing 6 digits would be worth attempting.
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
      throw ApiException.rateLimited('Too many incorrect codes — request a new login');
    }

    if (!(await otpMatches(this.otp, attempted, input.otp))) {
      throw ApiException.unauthorized('That code is not correct');
    }

    // Claiming the challenge conditionally is what makes a correct code
    // single-use: two requests carrying the same valid code race here, and only
    // the one that flips `consumed_at` walks away with a session.
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

    const fleet = await this.fleetOwnedBy(challenge.subjectId);
    if (!fleet) throw ApiException.forbidden('This account no longer owns a fleet');
    if (fleet.status === 'suspended') throw ApiException.forbidden('This fleet account is suspended');

    await this.db
      .update(fleetOwnerCredentials)
      .set({ lastLoginAt: now, failedAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(fleetOwnerCredentials.userId, challenge.subjectId));

    const pair = await this.tokens.issueSession({
      subjectId: challenge.subjectId,
      realm: FLEET_REALM,
      fleetId: fleet.id,
      context,
    });

    return {
      ...pair,
      fleet: { id: fleet.id, businessName: fleet.businessName },
    };
  }

  // Both pass `FLEET_REALM` explicitly: these are the fleet console's routes, so
  // a customer or driver token presented here must be refused without touching
  // the family it belongs to.
  async refresh(refreshToken: string, context: SessionContext = {}) {
    return this.tokens.rotate(refreshToken, FLEET_REALM, context);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.logout(refreshToken, FLEET_REALM);
  }

  async me(fleetId: string, userId: string) {
    const [row] = await this.db
      .select({ fleet: fleets, owner: users })
      .from(fleets)
      .innerJoin(users, eq(users.id, fleets.ownerId))
      .where(and(eq(fleets.id, fleetId), eq(fleets.ownerId, userId)))
      .limit(1);

    // The token is valid but its fleet binding no longer holds — ownership
    // changed or the fleet was deleted since the token was minted.
    if (!row) throw ApiException.notFound('Fleet not found');

    return {
      fleet: {
        id: row.fleet.id,
        businessName: row.fleet.businessName,
        status: row.fleet.status,
        gstin: row.fleet.gstin,
        address: row.fleet.address,
      },
      owner: {
        id: row.owner.id,
        name: row.owner.name,
        email: row.owner.email,
        mobile: row.owner.mobile,
      },
    };
  }

  private async fleetOwnedBy(userId: string) {
    const [fleet] = await this.db
      .select()
      .from(fleets)
      .where(eq(fleets.ownerId, userId))
      .orderBy(fleets.createdAt)
      .limit(1);

    return fleet;
  }

  /**
   * Increment and lock decision happen in one statement for the same reason as
   * the OTP counter: parallel guesses must not each read the pre-lock count.
   */
  private async recordFailedAttempt(credentialId: string, now: Date): Promise<void> {
    const lockedUntil = new Date(now.getTime() + LOCKOUT_SECONDS * 1000);

    await this.db
      .update(fleetOwnerCredentials)
      .set({
        failedAttempts: sql`${fleetOwnerCredentials.failedAttempts} + 1`,
        // toISOString: raw `sql` fragments bypass drizzle's column mapping, and
        // postgres.js rejects a bare Date at Bind time — which would turn every
        // wrong-password attempt into a 500 instead of a counted failure.
        lockedUntil: sql`case when ${fleetOwnerCredentials.failedAttempts} + 1 >= ${MAX_FAILED_ATTEMPTS} then ${lockedUntil.toISOString()}::timestamptz else ${fleetOwnerCredentials.lockedUntil} end`,
        updatedAt: now,
      })
      .where(eq(fleetOwnerCredentials.id, credentialId));
  }
}
