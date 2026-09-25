import { Inject, Injectable } from '@nestjs/common';
import type {
  CustomerSession,
  DriverSession,
  OtpSendRequest,
  OtpSendResponse,
  OtpVerifyRequest,
  PublicAuthRole,
  SocialLoginRequest,
} from '@towing/api-contracts';
import { and, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import { loginChallenges, otpVerifications } from '../../db/schema';
import { OtpRateService } from '../auth/otp-rate.service';
import { OTP_PORT, type OtpPort, type OtpPurpose } from '../auth/otp.port';
import { TokenService, type SessionContext } from '../auth/token.service';
import { SocialIdentityRegistry } from './social/social-identity.registry';
import { REALM_FOR_ROLE, SubjectRepo, type PublicSubject } from './subject.repo';
import { deliverOtp, otpMatches } from '../auth/otp-delivery';
import { digest, generateOtp } from '../auth/otp.util';

/** Every way step 2 can fail says the same thing — the challenge id is opaque. */
const CHALLENGE_REJECTED = 'This login challenge is no longer valid';

const OTP_PURPOSE: Record<PublicAuthRole, OtpPurpose> = {
  customer: 'customer_login',
  driver: 'driver_login',
};

export type PublicSession = CustomerSession | DriverSession;

/**
 * Phone-OTP and social login for the customer and driver apps (§15.2, §16.1).
 *
 * Structurally a sibling of `AuthService`, and deliberately so: the single-use
 * challenge claim, the increment-and-read attempt cap and the constant-time
 * digest comparison are the same three mechanisms, because they are the ones
 * that make a 6-digit second factor safe. What differs is only the first factor
 * — there is no password in either app — and the fact that an unknown number
 * provisions rather than fails.
 */
@Injectable()
export class AuthPublicService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(OTP_PORT) private readonly otp: OtpPort,
    private readonly tokens: TokenService,
    private readonly subjects: SubjectRepo,
    private readonly otpRate: OtpRateService,
    private readonly social: SocialIdentityRegistry,
  ) {}

  /** Step 1: a number produces a challenge, never a session. */
  async sendOtp(input: OtpSendRequest): Promise<OtpSendResponse> {
    // Before the account lookup, so the cost control cannot be bypassed by
    // cycling numbers that do not exist yet — each one would otherwise create a
    // row AND send a message.
    await this.otpRate.consume(input.mobile);

    const subject = await this.subjects.findOrCreateByMobile(input.role, input.mobile);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.env.OTP_TTL_SECONDS * 1000);
    const code = generateOtp();

    // Only the digest is stored. SHA-256 without a work factor is deliberate: a
    // 6-digit code has ~20 bits of entropy, so no KDF cost would meaningfully
    // slow an offline search. What protects it is the attempt cap plus the TTL
    // enforced in `verifyOtp`, not the strength of the hash.
    const [otp] = await this.db
      .insert(otpVerifications)
      .values({
        phone: input.mobile,
        purpose: OTP_PURPOSE[input.role],
        codeHash: digest(code),
        expiresAt,
      })
      .returning({ id: otpVerifications.id });

    const [challenge] = await this.db
      .insert(loginChallenges)
      .values({
        subjectId: subject.id,
        // The column migration 0007 exists for: a driver id is not a `users` id.
        subjectType: input.role === 'customer' ? 'user' : 'driver',
        realm: REALM_FOR_ROLE[input.role],
        otpId: otp!.id,
        expiresAt,
      })
      .returning({ id: loginChallenges.id });

    await deliverOtp(this.db, this.otp, {
      id: otp!.id,
      phone: input.mobile,
      code,
      purpose: OTP_PURPOSE[input.role],
    });

    return {
      challengeId: challenge!.id,
      expiresAt: expiresAt.toISOString(),
      resendAfterSeconds: this.otpRate.resendAfterSeconds(),
    };
  }

  /** Step 2: challenge + code becomes a session. */
  async verifyOtp(input: OtpVerifyRequest, context: SessionContext = {}): Promise<PublicSession> {
    const now = new Date();

    const [challenge] = await this.db
      .select()
      .from(loginChallenges)
      .where(eq(loginChallenges.id, input.challengeId))
      .limit(1);

    const role = roleForRealm(challenge?.realm);
    if (!challenge || !role || challenge.consumedAt || challenge.expiresAt <= now) {
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
      throw ApiException.rateLimited('Too many incorrect codes — request a new code');
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

    const subject = await this.subjects.findById(role, challenge.subjectId);
    if (!subject) throw ApiException.unauthorized(CHALLENGE_REJECTED);

    return this.sessionFor(role, subject, context, await this.isFirstLogin(challenge.subjectId));
  }

  /**
   * Whether the challenge just consumed is this subject's FIRST completed login.
   *
   * Counted from consumed challenges rather than taken from "did this request
   * create the row": someone who asks for a code, abandons it, and comes back a
   * week later did not become a new user in between, and the row was already
   * there. `isNew` drives whether the app routes to profile setup, so it needs
   * to mean "has never signed in", which is exactly what this counts.
   */
  private async isFirstLogin(subjectId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(loginChallenges)
      .where(
        and(eq(loginChallenges.subjectId, subjectId), isNotNull(loginChallenges.consumedAt)),
      );

    // The current challenge is already consumed by this point, so one is first.
    return (row?.count ?? 0) <= 1;
  }

  /** Google now; Apple is registered but disabled until Phase 13. */
  async socialLogin(input: SocialLoginRequest, context: SessionContext = {}): Promise<PublicSession> {
    const port = this.social.for(input.provider);
    const profile = await port.verify(input.idToken);

    const subject = await this.subjects.findOrCreateBySocial(
      input.role,
      input.provider,
      profile.subject,
      { email: profile.email, emailVerified: profile.emailVerified, name: profile.name },
    );

    // Social sign-in has no challenge to count, and the provider binding IS the
    // login record: a binding created just now is a first login by definition.
    return this.sessionFor(input.role, subject, context, subject.isNew);
  }

  /**
   * DEVELOPMENT ONLY — the code just issued for a challenge. Mirrors the fleet
   * console's echo and is guarded the same three ways: this route 404s unless
   * `AUTH_DEV_OTP_ECHO`, the adapter only records under the same flag, and
   * `assertProductionSafety` refuses to boot production with it set.
   *
   * Keyed on the challenge, not the number, so it cannot be used to harvest a
   * code for an arbitrary phone.
   */
  async devOtp(challengeId: string): Promise<{ otp: string }> {
    if (!this.env.AUTH_DEV_OTP_ECHO) throw ApiException.notFound();

    const [challenge] = await this.db
      .select({ realm: loginChallenges.realm, otpId: loginChallenges.otpId })
      .from(loginChallenges)
      .where(eq(loginChallenges.id, challengeId))
      .limit(1);

    if (!challenge || !roleForRealm(challenge.realm)) throw ApiException.notFound();

    const [otp] = await this.db
      .select({ phone: otpVerifications.phone })
      .from(otpVerifications)
      .where(eq(otpVerifications.id, challenge.otpId))
      .limit(1);

    const code = otp ? await this.otp.lastIssued?.(otp.phone) : null;
    if (!code) throw ApiException.notFound();

    return { otp: code };
  }

  async refresh(refreshToken: string, context: SessionContext = {}) {
    // Both mobile realms, and only those: a fleet or admin token presented here
    // is refused without its family being touched.
    return this.tokens.rotate(refreshToken, ['customer', 'driver'], context);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.logout(refreshToken, ['customer', 'driver']);
  }

  private async sessionFor(
    role: PublicAuthRole,
    subject: PublicSubject,
    context: SessionContext,
    isNew: boolean,
  ): Promise<PublicSession> {
    const pair = await this.tokens.issueSession({
      subjectId: subject.id,
      realm: REALM_FOR_ROLE[role],
      fleetId: subject.fleetId ?? null,
      context,
    });

    if (role === 'customer') {
      return {
        ...pair,
        customer: {
          id: subject.id,
          mobile: subject.mobile,
          name: subject.name,
          isNew,
        },
      };
    }

    return {
      ...pair,
      driver: {
        id: subject.id,
        mobile: subject.mobile,
        name: subject.name,
        kycStatus: subject.kycStatus ?? 'incomplete',
        fleetId: subject.fleetId ?? null,
        isNew,
      },
    };
  }
}

/** Null for the fleet and admin realms — their challenges are not ours to consume. */
function roleForRealm(realm: string | undefined): PublicAuthRole | null {
  if (realm === 'customer') return 'customer';
  if (realm === 'driver') return 'driver';
  return null;
}
