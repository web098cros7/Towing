import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, gt, inArray, isNull, notInArray, or, type SQL } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { ENV, type Env } from '../../config/env';
import { DB, type Database, type DatabaseExecutor } from '../../db/db.module';
import { refreshTokens } from '../../db/schema';
import { isActorRole, type AccessClaims, type AuthedRequest, type Realm } from './auth.types';
import { RealmPolicyRegistry, type RealmSessionLimits } from './realm.policy';
import { RefreshGraceService } from './refresh-grace.service';

/** Bytes of entropy in a refresh token. 48 → 64 base64url chars. */
const REFRESH_TOKEN_BYTES = 48;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Retained name — `refresh-grace.service.ts` and several specs import it. */
export type FleetTokenPair = TokenPair;

/** Who presented the token. Recorded for forensics after a reuse-triggered revoke. */
export interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

/** Pulls a `SessionContext` off a request — the one thing every admin-audited controller needs. */
export function sessionContextFrom(request: AuthedRequest): SessionContext {
  return { userAgent: request.headers['user-agent'] ?? null, ip: request.ip ?? null };
}

/**
 * Issues and rotates sessions for all four auth realms (§15.2).
 *
 * Access tokens are stateless JWTs; refresh tokens are opaque random values that
 * exist in the database only as a SHA-256 digest, so a database dump does not
 * hand out sessions. Rotation plus family-wide reuse detection is what turns a
 * stolen refresh token from a permanent session into a single-use one that
 * burns the whole family the moment the legitimate client refreshes.
 *
 * WHAT IS REALM-SPECIFIC LIVES IN `RealmPolicy`, not here. This class knows how
 * to mint, rotate and revoke; it does not know what a driver is. The two rules
 * it does enforce per realm are both parameters: which realms a given endpoint
 * will accept (`allowed`), and whether a null `fleet_id` is corruption
 * (`policy.requiresFleet`).
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
    private readonly grace: RefreshGraceService,
    private readonly policies: RealmPolicyRegistry,
  ) {}

  /**
   * Starts a new token family. Called once per completed login.
   *
   * `realm` is required and has no default: an optional one would let a driver
   * session be minted as a fleet session by omission, which is the single
   * worst mistake available in this file.
   */
  async issueSession(params: {
    subjectId: string;
    realm: Realm;
    fleetId?: string | null;
    context?: SessionContext;
  }): Promise<TokenPair> {
    const policy = this.policies.for(params.realm);
    // Login and refresh mint claims through the SAME path, so a session's
    // claims cannot differ depending on how it was obtained.
    const resolved = await policy.resolve(params.subjectId, params.fleetId ?? null);

    if (!resolved) {
      throw ApiException.forbidden('This account cannot start a session');
    }

    return this.mint({
      familyId: randomUUID(),
      subjectId: params.subjectId,
      realm: params.realm,
      fleetId: resolved.fleetId,
      claims: resolved.claims,
      context: params.context ?? {},
    });
  }

  /**
   * Exchanges a refresh token for a fresh pair inside the same family.
   *
   * The claim is a conditional UPDATE rather than a SELECT-then-UPDATE: two
   * concurrent refreshes with the same value must not both succeed, and the row
   * lock taken by the UPDATE is what guarantees exactly one winner.
   *
   * The loser then consults the grace window before reuse detection. Without it
   * a replayed value is indistinguishable from a stolen one and the family is
   * burned — which is the correct call for a replay minutes later, and the wrong
   * one for the four console tabs that all 401'd on the same expired access
   * token a millisecond ago. See `refresh-grace.service.ts` for the trade.
   */
  async rotate(
    presented: string,
    allowed: Realm | readonly Realm[],
    context: SessionContext = {},
  ): Promise<TokenPair> {
    const now = new Date();
    const tokenHash = digest(presented);
    const realms = normaliseRealms(allowed);

    // THE REALM PREDICATE MUST STAY IN THIS `WHERE`. Moved to a check after the
    // claim, probing the wrong endpoint would stamp `rotated_at` on a token the
    // prober does not own, and the victim's next legitimate refresh would trip
    // reuse detection and burn their family.
    //
    // W1 §3.6: realms that declare session windows (today only admin) also get
    // their idle and absolute checks IN THE PREDICATE. They cannot move after
    // the claim: `set` stamps `updatedAt` (and the returned row carries the new
    // value), so a post-hoc idle check would compare against the write it just
    // made and never fire. A rejected token instead falls through to
    // `explainFailedClaim`, which revokes the family and names the window.
    const sessionWindowPredicate = this.sessionWindowPredicate(realms, now);

    const [claimed] = await this.db
      .update(refreshTokens)
      .set({ rotatedAt: now, updatedAt: now })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          inArray(refreshTokens.realm, realms as string[]),
          isNull(refreshTokens.rotatedAt),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
          sessionWindowPredicate,
        ),
      )
      .returning();

    if (!claimed) {
      // Grace replay BEFORE reuse detection. Inside the window a re-presented
      // token is a concurrent client; outside it, nothing has changed and
      // explainFailedClaim still burns the family.
      //
      // Realm-scoped: the parked pair is keyed by token hash alone, so without
      // this a customer token replayed at the fleet refresh route inside the
      // window would be handed the customer's own pair BY THE FLEET ROUTE.
      const graced = await this.grace.get(tokenHash, realms);
      if (graced) return graced;

      throw await this.explainFailedClaim(tokenHash, realms);
    }

    const realm = claimed.realm as Realm;
    const policy = this.policies.for(realm);

    // Only the fleet realm binds to a tenant. Treating a null `fleet_id` as
    // corruption unconditionally — which is what this did before Phase 10 —
    // burned the family of every customer, driver and admin on first refresh.
    if (policy.requiresFleet && !claimed.fleetId) {
      await this.revokeFamily(claimed.familyId, 'missing_fleet_binding');
      throw ApiException.unauthorized('Session is not bound to a fleet');
    }

    // Claims are REBUILT from current state, never copied off the row: a driver
    // approved five minutes ago must refresh into `kyc_status: 'approved'`.
    const resolved = await policy.resolve(claimed.subjectId, claimed.fleetId);
    if (!resolved) {
      // Suspended, deleted, or no longer bound. Revoking the family here is
      // what makes losing authority immediate rather than eventual.
      await this.revokeFamily(claimed.familyId, 'subject_unavailable');
      throw ApiException.unauthorized('This session is no longer valid');
    }

    const pair = await this.mint({
      familyId: claimed.familyId,
      subjectId: claimed.subjectId,
      realm,
      fleetId: resolved.fleetId,
      claims: resolved.claims,
      context: {
        userAgent: context.userAgent ?? claimed.userAgent,
        ip: context.ip ?? claimed.ip,
      },
    });

    // Deliberately after mint, and deliberately not atomic with it. A crash in
    // between costs one re-login, because a concurrent refresh then finds no
    // parked pair and takes the old path. That is the safe direction to fail,
    // and it is worth a sentence rather than a distributed transaction.
    await this.grace.remember(tokenHash, realm, pair);

    return pair;
  }

  /**
   * Logout revokes the whole family, not just the presented token: the point of
   * signing out is that no descendant of this login can be refreshed afterwards.
   * Unknown values return quietly so logout cannot be used as a token oracle,
   * and so does an off-realm one, for the same reason.
   *
   * Before Phase 10 this early-returned for EVERY non-fleet realm, so a driver
   * logout would have returned 204 having revoked nothing. What fixes that is
   * the call site passing its own realm rather than the method assuming one.
   */
  async logout(presented: string, allowed: Realm | readonly Realm[]): Promise<void> {
    const realms = normaliseRealms(allowed);

    const [row] = await this.db
      .select({ familyId: refreshTokens.familyId, realm: refreshTokens.realm })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, digest(presented)))
      .limit(1);

    if (!row || !realms.includes(row.realm as Realm)) return;

    await this.revokeFamily(row.familyId, 'logout');
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    const now = new Date();

    await this.db
      .update(refreshTokens)
      .set({ revokedAt: now, revokedReason: reason, updatedAt: now })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  /**
   * Revokes every live family a subject holds in one realm, and returns how
   * many rows it touched.
   *
   * This is the "authority dies now" primitive. §9.4.3 requires suspending a
   * driver to take effect immediately, and a `kyc_status` update alone would
   * leave their current access token valid for the rest of its 900-second life.
   * Phase 11's suspend/reject actions call this; `RealmPolicy.resolve` covers
   * the same ground from the other direction, one refresh later.
   *
   * A15/W19: `options.tx` runs the UPDATE inside the caller's transaction. The
   * account-deletion request uses it so the request row, the suspension and the
   * revocation commit together — half a deletion request (row filed, sessions
   * still live) is the one state the subject must never observe.
   */
  async revokeSubject(
    subjectId: string,
    realm: Realm,
    reason: string,
    options: { tx?: DatabaseExecutor } = {},
  ): Promise<number> {
    const db = options.tx ?? this.db;
    const now = new Date();

    const revoked = await db
      .update(refreshTokens)
      .set({ revokedAt: now, revokedReason: reason, updatedAt: now })
      .where(
        and(
          eq(refreshTokens.subjectId, subjectId),
          eq(refreshTokens.realm, realm),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ id: refreshTokens.id });

    return revoked.length;
  }

  /**
   * Validates only what every realm shares: a subject and a known role.
   *
   * Role-SPECIFIC shape (an admin's `sub_role`, a driver's `kyc_status`) is
   * deliberately NOT checked here. A signature-valid token carrying the wrong
   * realm must fail as a 403 in the guard — "authenticated, wrong console" —
   * not as a 401 from this method, which would report it as "not logged in".
   */
  async verifyAccessToken(token: string): Promise<AccessClaims> {
    let payload: Partial<AccessClaims>;
    try {
      payload = await this.jwt.verifyAsync<Partial<AccessClaims>>(token);
    } catch {
      throw ApiException.unauthorized('Access token is invalid or expired');
    }

    // A signature-valid token with the wrong shape means someone is signing with
    // our secret from outside this service; treat it as hostile, not as a bug.
    if (typeof payload.sub !== 'string' || !isActorRole(payload.role)) {
      throw ApiException.unauthorized('Access token is malformed');
    }

    return payload as AccessClaims;
  }

  private async mint(params: {
    familyId: string;
    subjectId: string;
    realm: Realm;
    fleetId: string | null;
    claims: AccessClaims;
    context: SessionContext;
  }): Promise<TokenPair> {
    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');

    await this.db.insert(refreshTokens).values({
      familyId: params.familyId,
      subjectId: params.subjectId,
      realm: params.realm,
      fleetId: params.fleetId,
      tokenHash: digest(refreshToken),
      expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL_SECONDS * 1000),
      userAgent: params.context.userAgent ?? null,
      ip: params.context.ip ?? null,
    });

    return { accessToken: await this.jwt.signAsync(params.claims), refreshToken };
  }

  /**
   * The WHERE-clause half of the per-realm session policy (§3.6, G15).
   *
   * For every allowed realm that declares limits, a token must satisfy BOTH
   * windows to rotate: it must have been used within `idleMs` (measured from
   * the pre-rotation `updatedAt`) and minted within `absoluteMs` (measured from
   * `createdAt`). Realms without limits — fleet, customer, driver — match
   * unconditionally, so their behaviour is byte-identical to before W1.
   *
   * Returns `undefined` when no allowed realm is limited, which drizzle's
   * `and()` drops, leaving the claim exactly as it was.
   */
  private sessionWindowPredicate(realms: readonly Realm[], now: Date): SQL | undefined {
    const limited = realms
      .map((realm) => ({ realm, limits: this.policies.limitsFor(realm) }))
      .filter(
        (entry): entry is { realm: Realm; limits: RealmSessionLimits } => entry.limits !== null,
      );

    if (limited.length === 0) return undefined;

    return or(
      notInArray(refreshTokens.realm, limited.map((entry) => entry.realm)),
      ...limited.map(({ realm, limits }) =>
        and(
          eq(refreshTokens.realm, realm),
          gt(refreshTokens.updatedAt, new Date(now.getTime() - limits.idleMs)),
          gt(refreshTokens.createdAt, new Date(now.getTime() - limits.absoluteMs)),
        ),
      ),
    );
  }

  /**
   * Works out why the conditional claim matched nothing. Returns the exception
   * to throw (rather than throwing) so the caller keeps a `throw` on its own
   * control-flow path and TypeScript can see the function never falls through.
   *
   * BRANCH ORDER IS LOAD-BEARING. The off-realm check must precede the
   * rotated/revoked one: reverse them and probing the wrong endpoint with a
   * valid token burns a family the prober does not own.
   */
  private async explainFailedClaim(
    tokenHash: string,
    realms: readonly Realm[],
  ): Promise<ApiException> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!row) return ApiException.unauthorized('Refresh token is not recognised');
    if (!realms.includes(row.realm as Realm)) {
      return ApiException.unauthorized('Refresh token belongs to a different auth realm');
    }

    // Already rotated or already revoked means the value is in two places at
    // once. There is no way to tell the thief from the victim, so every token
    // descended from this login is burned and both sides must log in again.
    if (row.rotatedAt || row.revokedAt) {
      await this.revokeFamily(row.familyId, row.revokedAt ? 'family_revoked' : 'refresh_token_reuse');
      return ApiException.unauthorized('Refresh token was already used; this session has been revoked');
    }

    // W1 §3.6: not rotated, not revoked, not expired by TTL — so if the realm
    // declares windows, one of them is why the claim missed. Revoking here is
    // what makes the rejection final: without it the same row could be raced
    // forever, and a deactivated-then-reactivated admin would resurrect it.
    if (this.policies.has(row.realm)) {
      const limits = this.policies.limitsFor(row.realm);
      if (limits) {
        const nowMs = Date.now();
        if (nowMs - row.updatedAt.getTime() > limits.idleMs) {
          await this.revokeFamily(row.familyId, 'idle_timeout');
          return ApiException.unauthorized(
            `Session expired after ${Math.round(limits.idleMs / 60_000)} minutes of inactivity`,
          );
        }
        if (nowMs - row.createdAt.getTime() > limits.absoluteMs) {
          await this.revokeFamily(row.familyId, 'absolute_timeout');
          return ApiException.unauthorized(
            `Session reached its ${Math.round(limits.absoluteMs / 3_600_000)}-hour limit`,
          );
        }
      }
    }

    return ApiException.unauthorized('Refresh token has expired');
  }
}

function normaliseRealms(allowed: Realm | readonly Realm[]): readonly Realm[] {
  return typeof allowed === 'string' ? [allowed] : allowed;
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
