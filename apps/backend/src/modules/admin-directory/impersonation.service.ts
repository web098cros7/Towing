import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type {
  AdminAppViewAddressesResponse,
  AdminAppViewCursorQuery,
  AdminAppViewNotificationsResponse,
  AdminAppViewTripsResponse,
  AdminAppViewVehiclesResponse,
  AdminAppViewWalletResponse,
  AdminImpersonationResponse,
  AdminImpersonationSession,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { impersonationSessions, users } from '../../db/schema';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { SessionContext } from '../auth/token.service';
import { BookingsService } from '../bookings/bookings.service';
import { MeAddressesService } from '../me/me-addresses.service';
import { MeVehiclesService } from '../me/me-vehicles.service';
import { WalletService } from '../money/wallet.service';
import { NotificationCentreService } from '../notification-centre/notification-centre.service';

/** G8: how long an impersonation session stays valid — the guide's 30 minutes. */
const SESSION_TTL_MS = 30 * 60_000;

/**
 * G8's read-only impersonation (§9.4.4) — server-side, audited, no token.
 *
 * A session row authorises NOTHING by itself. Starting impersonation checks the
 * user exists, reuses an open session (a page reload must not fork sessions),
 * and writes ONE `impersonate.start` audit row. Every app-view read then names
 * the session and is audited against it; an ended or expired session is
 * refused — a stale tab cannot keep reading someone's account.
 *
 * THE READS GO THROUGH THE CUSTOMER SERVICES, with an explicit userId in place
 * of a session subject. The response schemas are the customer contracts
 * wholesale: "what the customer sees" has exactly one definition.
 */
@Injectable()
export class ImpersonationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AdminAuditService,
    private readonly bookings: BookingsService,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationCentreService,
    private readonly vehicles: MeVehiclesService,
    private readonly addresses: MeAddressesService,
  ) {}

  async start(
    adminId: string,
    userId: string,
    reason: string,
    context: SessionContext = {},
  ): Promise<AdminImpersonationResponse> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw ApiException.notFound('User not found');

    // Reloading the console must not fork sessions: an open, unexpired one for
    // this admin and subject is returned as-is. (No second audit row either —
    // the decision was already recorded.)
    const [open] = await this.db
      .select()
      .from(impersonationSessions)
      .where(
        and(
          eq(impersonationSessions.adminId, adminId),
          eq(impersonationSessions.subjectId, userId),
          isNull(impersonationSessions.endedAt),
          gt(impersonationSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (open) return { session: sessionOf(open) };

    const now = new Date();
    const [row] = await this.db
      .insert(impersonationSessions)
      .values({
        adminId,
        subjectType: 'user',
        subjectId: userId,
        reason,
        startedAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      })
      .returning();

    await this.audit.record({
      adminId,
      action: 'impersonate.start',
      subjectType: 'user',
      subjectId: userId,
      after: { sessionId: row!.id, expiresAt: row!.expiresAt.toISOString() },
      reason,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { session: sessionOf(row!) };
  }

  /** Ending a session is idempotent and audits only the first time. */
  async end(
    adminId: string,
    userId: string,
    sessionId: string,
    context: SessionContext = {},
  ): Promise<AdminImpersonationResponse> {
    const session = await this.sessionOrThrow(adminId, userId, sessionId);
    if (session.endedAt) return { session: sessionOf(session) };

    const endedAt = new Date();
    const [row] = await this.db
      .update(impersonationSessions)
      .set({ endedAt })
      .where(eq(impersonationSessions.id, sessionId))
      .returning();
    await this.audit.record({
      adminId,
      action: 'impersonate.end',
      subjectType: 'user',
      subjectId: userId,
      after: { sessionId },
      reason: null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
    return { session: sessionOf(row!) };
  }

  async trips(
    adminId: string,
    userId: string,
    query: AdminAppViewCursorQuery,
  ): Promise<AdminAppViewTripsResponse> {
    await this.requireLiveSession(adminId, userId, query.session);
    const result = await this.bookings.list(userId, query.limit, query.cursor);
    await this.auditRead(adminId, userId, query.session, 'trips');
    return result;
  }

  async walletView(
    adminId: string,
    userId: string,
    query: { session: string },
  ): Promise<AdminAppViewWalletResponse> {
    await this.requireLiveSession(adminId, userId, query.session);
    const [wallet, transactions] = await Promise.all([
      this.wallet.balance(userId),
      this.wallet.transactions(userId),
    ]);
    await this.auditRead(adminId, userId, query.session, 'wallet');
    return { wallet, transactions: transactions.items };
  }

  async notificationsView(
    adminId: string,
    userId: string,
    query: AdminAppViewCursorQuery,
  ): Promise<AdminAppViewNotificationsResponse> {
    await this.requireLiveSession(adminId, userId, query.session);
    const result = await this.notifications.list('user', userId, {
      cursor: query.cursor,
      limit: query.limit,
    });
    await this.auditRead(adminId, userId, query.session, 'notifications');
    return result;
  }

  async vehiclesView(
    adminId: string,
    userId: string,
    query: { session: string },
  ): Promise<AdminAppViewVehiclesResponse> {
    await this.requireLiveSession(adminId, userId, query.session);
    const items = await this.vehicles.list(userId);
    await this.auditRead(adminId, userId, query.session, 'vehicles');
    return { items };
  }

  async addressesView(
    adminId: string,
    userId: string,
    query: { session: string },
  ): Promise<AdminAppViewAddressesResponse> {
    await this.requireLiveSession(adminId, userId, query.session);
    const items = await this.addresses.list(userId);
    await this.auditRead(adminId, userId, query.session, 'addresses');
    return { items };
  }

  // ---------------------------------------------------------------------------

  /**
   * The session must belong to THIS admin about THIS subject, must be open and
   * unexpired. A session for someone else's subject is a not-found, not a
   * forbidden: leaking which session ids exist is not this route's job.
   */
  private async requireLiveSession(
    adminId: string,
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const session = await this.sessionOrThrow(adminId, userId, sessionId);
    if (session.endedAt) {
      throw ApiException.forbidden('This impersonation session has ended', { sessionId });
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw ApiException.forbidden('This impersonation session has expired', { sessionId });
    }
  }

  private async sessionOrThrow(adminId: string, userId: string, sessionId: string) {
    const [session] = await this.db
      .select()
      .from(impersonationSessions)
      .where(
        and(
          eq(impersonationSessions.id, sessionId),
          eq(impersonationSessions.adminId, adminId),
          eq(impersonationSessions.subjectId, userId),
        ),
      )
      .limit(1);
    if (!session) throw ApiException.notFound('Impersonation session not found');
    return session;
  }

  /** One `admin_actions` row per section read, session id in `after` (rule 5). */
  private async auditRead(
    adminId: string,
    userId: string,
    sessionId: string,
    section: string,
  ): Promise<void> {
    await this.audit.record({
      adminId,
      action: 'impersonate.read',
      subjectType: 'user',
      subjectId: userId,
      after: { sessionId, section },
      reason: null,
      ip: null,
      userAgent: null,
    });
  }
}

function sessionOf(row: typeof impersonationSessions.$inferSelect): AdminImpersonationSession {
  return {
    id: row.id,
    adminId: row.adminId,
    subjectType: 'user',
    subjectId: row.subjectId,
    reason: row.reason,
    startedAt: row.startedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
  };
}
