import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminCompletePasswordChange,
  AdminIdentity,
  AdminLoginChallenge,
  AdminLoginRequest,
  AdminOtpVerifyRequest,
  AdminRecoveryCodesResponse,
  AdminSession,
  AdminSessionsResponse,
  AdminTotpConfirm,
  AdminTotpDisable,
  AdminTotpEnrollResponse,
  AdminTotpStatus,
} from '@towing/api-contracts';
import { ErrorCodes } from '@towing/api-contracts';
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { ApiException } from '../../common/errors/api-exception';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import {
  adminRecoveryCodes,
  adminUsers,
  loginChallenges,
  otpVerifications,
  refreshTokens,
} from '../../db/schema';
import { ADMIN_REVOKE_CHANNEL, REDIS } from '../../redis/redis.constants';
import { deliverOtp, otpMatches } from '../auth/otp-delivery';
import { OTP_PORT, type OtpPort } from '../auth/otp.port';
import { hashPassword, verifyDecoyPassword, verifyPassword } from '../auth/password';
import { ADMIN_SESSION_LIMITS } from '../auth/policies/admin.policy';
import { TokenService, type SessionContext } from '../auth/token.service';
import { AdminAuditService } from './admin-audit.service';
import { TotpService, hashRecoveryCode } from './totp.service';
import { AdminAuthzService } from '../auth/admin-authz.service';

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
    @Inject(REDIS) private readonly redis: Redis,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly audit: AdminAuditService,
    private readonly adminAuthz: AdminAuthzService,
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
      await deliverOtp(this.db, this.otp, {
        id: otp!.id,
        phone: admin.mobile,
        code: code!,
        purpose: 'admin_login',
      });
    }

    return { challengeId: challenge!.id, expiresAt: expiresAt.toISOString(), method };
  }

  /**
   * Step 2. Branches on the admin's enrolled second factor: SMS codes go
   * through the OTP row as before; TOTP codes (and recovery codes) go through
   * the TOTP branch, which counts attempts on the SAME placeholder OTP row —
   * so a TOTP challenge gets the identical 5-guess cap rather than a new,
   * unbracketed one.
   */
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

    const [adminRow] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, challenge.subjectId))
      .limit(1);

    if (!adminRow || adminRow.status !== 'active') {
      throw ApiException.forbidden('This admin account is not active');
    }

    // A temporary password never becomes a session: the challenge stays live
    // so the completion route can still accept it, and nothing is consumed.
    if (adminRow.mustChangePassword) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCodes.PASSWORD_CHANGE_REQUIRED,
        'A password change is required before signing in — complete it to continue',
      );
    }

    if (adminRow.twofaEnabled && adminRow.twofaSecretEnc) {
      await this.verifyTotpStep(
        adminRow.id,
        challenge.otpId,
        adminRow.twofaSecretEnc,
        adminRow.twofaLastCounter,
        input.otp,
        now,
      );
    } else {
      await this.verifySmsStep(challenge.otpId, input.otp, now);
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
      .where(eq(otpVerifications.id, challenge.otpId));

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

  /** The pre-W2 SMS path, unchanged: increment-and-read attempts, compare digests. */
  private async verifySmsStep(otpId: string, code: string, now: Date): Promise<void> {
    // Increment and read in one statement so the cap holds under a burst of
    // parallel guesses.
    const [attempted] = await this.db
      .update(otpVerifications)
      .set({ attempts: sql`${otpVerifications.attempts} + 1` })
      .where(
        and(
          eq(otpVerifications.id, otpId),
          eq(otpVerifications.used, false),
          lt(otpVerifications.attempts, this.env.OTP_MAX_ATTEMPTS),
          gt(otpVerifications.expiresAt, now),
        ),
      )
      .returning();

    if (!attempted) {
      throw ApiException.rateLimited('Too many incorrect codes — start the login again');
    }

    if (!(await otpMatches(this.otp, attempted, code))) {
      throw ApiException.unauthorized('That code is not correct');
    }
  }

  /**
   * The W2 TOTP path. Recovery codes (8 chars) are tried first — they burn on
   * use — then the authenticator code against steps −1/0/+1. A replayed code
   * fails with the SAME message as a wrong one: distinguishing them tells an
   * attacker holding an intercepted code exactly how long it stays live.
   */
  private async verifyTotpStep(
    adminId: string,
    otpId: string,
    secretEnc: string,
    lastCounter: number | null,
    code: string,
    now: Date,
  ): Promise<void> {
    const [attempted] = await this.db
      .update(otpVerifications)
      .set({ attempts: sql`${otpVerifications.attempts} + 1` })
      .where(
        and(
          eq(otpVerifications.id, otpId),
          eq(otpVerifications.used, false),
          lt(otpVerifications.attempts, this.env.OTP_MAX_ATTEMPTS),
          gt(otpVerifications.expiresAt, now),
        ),
      )
      .returning();

    if (!attempted) {
      throw ApiException.rateLimited('Too many incorrect codes — start the login again');
    }

    if (code.length === 8) {
      const burned = await this.consumeRecoveryCode(adminId, code, now);
      if (burned) return;
      throw ApiException.unauthorized('That code is not correct');
    }

    let secret: string;
    try {
      secret = this.totp.decryptSecret(secretEnc);
    } catch {
      throw ApiException.unauthorized('That code is not correct');
    }

    const counter = await this.totp.verifyCode(secret, code);
    if (counter === null) {
      throw ApiException.unauthorized('That code is not correct');
    }

    // Conditional advance: the first use of a step wins, a replay (or a
    // concurrent double-submit) finds the row already moved and fails.
    const [moved] = await this.db
      .update(adminUsers)
      .set({ twofaLastCounter: counter })
      .where(
        and(
          eq(adminUsers.id, adminId),
          lastCounter === null
            ? isNull(adminUsers.twofaLastCounter)
            : lt(adminUsers.twofaLastCounter, counter),
        ),
      )
      .returning({ id: adminUsers.id });

    if (!moved) {
      throw ApiException.unauthorized('That code is not correct');
    }
  }

  /**
   * Burns one unused recovery code. The conditional update is the whole
   * single-use guarantee: two concurrent logins with the same code race, one
   * wins, the other reads nothing back.
   */
  private async consumeRecoveryCode(adminId: string, code: string, now: Date): Promise<boolean> {
    const candidates = await this.db
      .select({ id: adminRecoveryCodes.id, codeHash: adminRecoveryCodes.codeHash })
      .from(adminRecoveryCodes)
      .where(and(eq(adminRecoveryCodes.adminId, adminId), isNull(adminRecoveryCodes.usedAt)));

    const wanted = hashRecoveryCode(code);
    for (const candidate of candidates) {
      const left = Buffer.from(candidate.codeHash, 'utf8');
      const right = Buffer.from(wanted, 'utf8');
      if (left.length !== right.length || !timingSafeEqual(left, right)) continue;

      const [burned] = await this.db
        .update(adminRecoveryCodes)
        .set({ usedAt: now })
        .where(and(eq(adminRecoveryCodes.id, candidate.id), isNull(adminRecoveryCodes.usedAt)))
        .returning({ id: adminRecoveryCodes.id });
      return burned !== undefined;
    }

    return false;
  }

  /**
   * Completes a forced password change with the still-live login challenge.
   * No session exists at this point (`verify` refused to mint one), so the
   * unconsumed challenge is the only authority accepted — never a bearer.
   */
  async completePasswordChange(
    input: AdminCompletePasswordChange,
    context: SessionContext = {},
  ): Promise<AdminSession> {
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

    const [adminRow] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, challenge.subjectId))
      .limit(1);

    if (!adminRow || adminRow.status !== 'active') {
      throw ApiException.forbidden('This admin account is not active');
    }
    if (!adminRow.mustChangePassword) {
      throw ApiException.conflict('No password change is pending for this account');
    }

    await this.db
      .update(adminUsers)
      .set({
        passwordHash: await hashPassword(input.newPassword),
        mustChangePassword: false,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(adminUsers.id, adminRow.id));
    // The 0022 trigger bumps `authz_version` on the password_hash write, so
    // any older session dies with the old credential — the session minted
    // below already carries the new version.

    const [consumed] = await this.db
      .update(loginChallenges)
      .set({ consumedAt: now })
      .where(and(eq(loginChallenges.id, challenge.id), isNull(loginChallenges.consumedAt)))
      .returning({ id: loginChallenges.id });
    if (!consumed) throw ApiException.unauthorized(CHALLENGE_REJECTED);

    await this.db
      .update(otpVerifications)
      .set({ used: true })
      .where(eq(otpVerifications.id, challenge.otpId));

    await this.audit.record({
      adminId: adminRow.id,
      action: 'admin.password_change',
      subjectType: 'admin',
      subjectId: adminRow.id,
      before: { mustChangePassword: true },
      after: { mustChangePassword: false },
      reason: null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    const admin = await this.identity(adminRow.id);
    if (!admin) throw ApiException.forbidden('This admin account is not active');

    await this.db
      .update(adminUsers)
      .set({ lastLoginAt: now, updatedAt: now })
      .where(eq(adminUsers.id, admin.id));

    const pair = await this.tokens.issueSession({
      subjectId: admin.id,
      realm: ADMIN_REALM,
      context,
    });

    return { ...pair, admin };
  }

  /**
   * Starts TOTP enrolment for the caller's own account. Returns the
   * `otpauth://` URI — the WEB renders the QR, the API never touches pixels.
   * Re-enrolment while unconfirmed restarts cleanly (old secret and codes
   * are replaced, never merged).
   */
  async totpEnroll(
    adminId: string,
    context: SessionContext = {},
  ): Promise<AdminTotpEnrollResponse> {
    const adminRow = await this.requireActiveAdmin(adminId);
    if (adminRow.twofaEnabled) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.TOTP_ALREADY_ENABLED,
        'Two-factor is already enabled',
      );
    }

    const secret = this.totp.generateSecret();
    const now = new Date();
    await this.db
      .update(adminUsers)
      .set({
        twofaSecretEnc: this.totp.encryptSecret(secret),
        twofaEnabled: false,
        twofaConfirmedAt: null,
        twofaLastCounter: null,
        updatedAt: now,
      })
      .where(eq(adminUsers.id, adminId));
    await this.db.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId, adminId));

    await this.audit.record({
      adminId,
      action: 'admin.2fa_enroll',
      subjectType: 'admin',
      subjectId: adminId,
      before: { twofaEnabled: false },
      after: { twofaEnabled: false },
      reason: null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      otpauthUri: this.totp.otpauthUri(adminRow.email, secret),
      secretPreview: `••••${secret.slice(-4)}`,
    };
  }

  /** Confirms an enrolment by proving possession: one correct code enables. */
  async totpConfirm(
    adminId: string,
    input: AdminTotpConfirm,
    context: SessionContext = {},
  ): Promise<AdminTotpStatus> {
    const adminRow = await this.requireActiveAdmin(adminId);
    if (adminRow.twofaEnabled) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.TOTP_ALREADY_ENABLED,
        'Two-factor is already enabled',
      );
    }
    if (!adminRow.twofaSecretEnc) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.TOTP_NOT_ENABLED,
        'Start enrolment before confirming',
      );
    }

    let secret: string;
    try {
      secret = this.totp.decryptSecret(adminRow.twofaSecretEnc);
    } catch {
      throw ApiException.unauthorized('That code is not correct');
    }

    // Possession proof only — the replay counter stays NULL (see below), so
    // the boolean is all confirmation needs.
    if ((await this.totp.verifyCode(secret, input.code)) === null) {
      throw ApiException.unauthorized('That code is not correct');
    }

    const now = new Date();
    // The counter stays NULL here on purpose: it tracks AUTHENTICATIONS, and
    // confirmation only binds the secret. Consuming the step at confirm would
    // refuse the admin's first real login whenever it lands in the same 30 s
    // window — the same code, minutes apart, presented by the same human who
    // just proved possession of the secret.
    await this.db
      .update(adminUsers)
      .set({ twofaEnabled: true, twofaConfirmedAt: now, updatedAt: now })
      .where(eq(adminUsers.id, adminId));

    await this.audit.record({
      adminId,
      action: 'admin.2fa_confirm',
      subjectType: 'admin',
      subjectId: adminId,
      before: { twofaEnabled: false },
      after: { twofaEnabled: true },
      reason: null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    this.adminAuthz.forget(adminId);
    return { enabled: true };
  }

  /**
   * Disables the caller's second factor. Burns recovery codes with it (they
   * authenticate the factor being removed) and revokes sessions: the account
   * just got weaker, so every session re-proves from the password.
   */
  async totpDisable(
    adminId: string,
    reason: string,
    context: SessionContext = {},
  ): Promise<AdminTotpStatus> {
    const adminRow = await this.requireActiveAdmin(adminId);
    if (!adminRow.twofaEnabled) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.TOTP_NOT_ENABLED,
        'Two-factor is not enabled',
      );
    }

    const now = new Date();
    await this.db
      .update(adminUsers)
      .set({
        twofaEnabled: false,
        twofaSecretEnc: null,
        twofaConfirmedAt: null,
        twofaLastCounter: null,
        updatedAt: now,
      })
      .where(eq(adminUsers.id, adminId));
    await this.db.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId, adminId));

    await this.audit.record({
      adminId,
      action: 'admin.2fa_disable',
      subjectType: 'admin',
      subjectId: adminId,
      before: { twofaEnabled: true },
      after: { twofaEnabled: false },
      reason,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    await this.tokens.revokeSubject(adminId, ADMIN_REALM, '2fa_disabled');
    this.adminAuthz.forget(adminId);
    await this.redis.publish(
      ADMIN_REVOKE_CHANNEL,
      JSON.stringify({ adminId, reason: '2fa_disabled', at: now.toISOString() }),
    );

    return { enabled: false };
  }

  /**
   * Rotates the caller's recovery codes. Old codes die with rotation (a
   * screenshot of the old sheet must not stay valid), and the plaintext is
   * returned exactly once — only hashes rest in the database.
   */
  async totpRecoveryCodes(
    adminId: string,
    context: SessionContext = {},
  ): Promise<AdminRecoveryCodesResponse> {
    const adminRow = await this.requireActiveAdmin(adminId);
    if (!adminRow.twofaEnabled) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.TOTP_NOT_ENABLED,
        'Enable two-factor before issuing recovery codes',
      );
    }

    const codes = this.totp.generateRecoveryCodes();
    const now = new Date();
    await this.db.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId, adminId));
    await this.db
      .insert(adminRecoveryCodes)
      .values(codes.map(({ codeHash }) => ({ adminId, codeHash, createdAt: now })));

    await this.audit.record({
      adminId,
      action: 'admin.2fa_recovery_codes',
      subjectType: 'admin',
      subjectId: adminId,
      before: null,
      after: { codesIssued: codes.length },
      reason: null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { codes: codes.map(({ code }) => code) };
  }

  private async requireActiveAdmin(adminId: string) {
    const [adminRow] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId))
      .limit(1);
    if (!adminRow || adminRow.status !== 'active') {
      throw ApiException.forbidden('This admin account is not active');
    }
    return adminRow;
  }

  async refresh(refreshToken: string, context: SessionContext = {}) {
    return this.tokens.rotate(refreshToken, ADMIN_REALM, context);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.logout(refreshToken, ADMIN_REALM);
  }

  /**
   * W1 §3.6 — the caller's live sessions, most recently used first.
   *
   * One session = one refresh-token FAMILY: a rotation inserts a new row and
   * stamps `rotated_at` on the parent, so "the family's one active row" is
   * exactly the set of sessions that can still be refreshed. The window
   * predicates use `ADMIN_SESSION_LIMITS`, the same numbers `TokenService.rotate`
   * enforces: a row rendered here is one that would rotate, and a row `rotate`
   * would refuse never appears.
   */
  async listSessions(adminId: string): Promise<AdminSessionsResponse> {
    const now = new Date();

    const rows = await this.db
      .select({
        id: refreshTokens.familyId,
        ip: refreshTokens.ip,
        userAgent: refreshTokens.userAgent,
        createdAt: refreshTokens.createdAt,
        lastUsedAt: refreshTokens.updatedAt,
        expiresAt: refreshTokens.expiresAt,
      })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.subjectId, adminId),
          eq(refreshTokens.realm, ADMIN_REALM),
          isNull(refreshTokens.rotatedAt),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
          gt(refreshTokens.updatedAt, new Date(now.getTime() - ADMIN_SESSION_LIMITS.idleMs)),
          gt(refreshTokens.createdAt, new Date(now.getTime() - ADMIN_SESSION_LIMITS.absoluteMs)),
        ),
      )
      .orderBy(desc(refreshTokens.updatedAt));

    return {
      sessions: rows.map((row) => ({
        id: row.id,
        ip: row.ip,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
    };
  }

  /**
   * Revokes one of the CALLER's own sessions — self-service, like the 2FA
   * routes: there is no `:adminId` segment, so one admin can never revoke
   * another's session through this route.
   *
   * An unknown id, another admin's family, and a family already dead are ONE
   * indistinguishable 404: a distinguishable "403 not yours" would let any
   * admin probe whether another admin's session ids exist. The audit row is
   * the exception — it records only the caller's own action, so it may name
   * the session.
   *
   * Revoking the CALLER'S CURRENT session is allowed on purpose: it is the
   * server-side half of "sign out everywhere", and locking the caller out of
   * the one act of self-protection would be the wrong trade.
   */
  async revokeSession(adminId: string, sessionId: string, context: SessionContext): Promise<void> {
    const [row] = await this.db
      .select({
        familyId: refreshTokens.familyId,
        ip: refreshTokens.ip,
        userAgent: refreshTokens.userAgent,
        createdAt: refreshTokens.createdAt,
      })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.familyId, sessionId),
          eq(refreshTokens.subjectId, adminId),
          eq(refreshTokens.realm, ADMIN_REALM),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .limit(1);

    if (!row) throw ApiException.notFound('Session not found');

    await this.tokens.revokeFamily(row.familyId, 'admin_session_revoked');
    await this.audit.record({
      adminId,
      action: 'admin.session_revoke',
      subjectType: 'admin',
      subjectId: adminId,
      before: {
        sessionId: row.familyId,
        ip: row.ip,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
      },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
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
      twofaEnrolmentRequired: this.adminAuthz.totpEnrolmentRequired(admin),
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

