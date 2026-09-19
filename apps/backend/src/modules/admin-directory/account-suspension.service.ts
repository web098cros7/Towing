import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  AdminDirectorySuspendResponse,
  SuspensionRequestSubjectType,
} from '@towing/api-contracts';
import { DeviceRegistryService } from '../../common/notifications/device-registry.service';
import { ApiException } from '../../common/errors/api-exception';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { DB, type Database } from '../../db/db.module';
import { bookings, users } from '../../db/schema';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import { AdminDriversService } from '../admin-drivers/admin-drivers.service';
import { FleetSuspensionService } from '../admin-fleets/fleet-suspension.service';
import { BookingStateMachineService } from '../bookings/booking-state-machine.service';
import { TokenService, type SessionContext } from '../auth/token.service';

/**
 * W6: ONE suspension service covering customer, driver and fleet, so the three
 * cannot drift — the work order's mandate, and A14/A15's side-effect chains
 * are the parts that must not be re-derived per subject.
 *
 * - user: status + metadata + audit in one transaction, then revoke the refresh
 *   family, revoke push devices, and cancel only SEARCHING bookings fee-free.
 *   An active trip is left running: a driver is mid-job, and ending it strands
 *   both parties (the guide's rule).
 * - driver: delegates to `AdminDriversService` (A14 — shelf vs immediate, the
 *   row lock, the deferred apply worker). Reimplementing that here would be the
 *   drift this service exists to prevent.
 * - fleet: delegates to `FleetSuspensionService` (A15). W6's later pass folds
 *   the revoke-reason/notification carry-forwards in; the entry point is
 *   already single.
 *
 * The searching-booking cancel deliberately does NOT go through
 * `BookingsService.cancel`: that is the CUSTOMER path (ownership check plus the
 * customer fee policy), and running it here would attribute the platform's
 * decision to the customer and could charge them for it.
 */
@Injectable()
export class AccountSuspensionService {
  private readonly logger = new Logger(AccountSuspensionService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
    private readonly audit: AdminAuditService,
    private readonly tokens: TokenService,
    private readonly devices: DeviceRegistryService,
    private readonly machine: BookingStateMachineService,
    private readonly adminDrivers: AdminDriversService,
    private readonly fleetSuspension: FleetSuspensionService,
  ) {}

  async suspendSubject(
    adminId: string,
    subjectType: SuspensionRequestSubjectType,
    subjectId: string,
    reason: string,
    context: SessionContext = {},
  ): Promise<AdminDirectorySuspendResponse> {
    switch (subjectType) {
      case 'user':
        return this.suspendUser(adminId, subjectId, reason, context);
      case 'driver': {
        await this.adminDrivers.decide(
          adminId,
          subjectId,
          { decision: 'suspend', reason },
          context,
        );
        return {
          subjectId,
          subjectType,
          status: 'suspended',
          cancelledSearchingBookings: 0,
        };
      }
      case 'fleet': {
        await this.fleetSuspension.suspend(adminId, subjectId, context);
        return {
          subjectId,
          subjectType,
          status: 'suspended',
          cancelledSearchingBookings: 0,
        };
      }
    }
  }

  async suspendUser(
    adminId: string,
    userId: string,
    reason: string,
    context: SessionContext = {},
  ): Promise<AdminDirectorySuspendResponse> {
    const [user] = await this.db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw ApiException.notFound('User not found');
    if (user.status === 'suspended') {
      // Idempotent — like A15's fleet suspend, re-running must not double-audit.
      return {
        subjectId: userId,
        subjectType: 'user',
        status: 'suspended',
        cancelledSearchingBookings: 0,
      };
    }

    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          status: 'suspended',
          suspendedAt: now,
          suspendedBy: adminId,
          suspensionReason: reason,
          updatedAt: now,
        })
        .where(eq(users.id, userId));
      await this.audit.record(
        {
          adminId,
          action: 'user.suspend',
          subjectType: 'user',
          subjectId: userId,
          before: { status: user.status },
          after: { status: 'suspended', reason },
          reason,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        },
        { tx },
      );
    });

    // After commit: lose authority everywhere, then clear the queue of live
    // searches. An active trip is deliberately untouched.
    await this.tokens.revokeSubject(userId, 'customer', 'user_suspend');
    await this.devices.revokeAllForSubject('user', userId, 'user_suspend');
    const cancelled = await this.cancelSearchingBookings(adminId, userId);

    this.logger.log(`event=user_suspended user=${userId} cancelled_searches=${cancelled}`);
    return {
      subjectId: userId,
      subjectType: 'user',
      status: 'suspended',
      cancelledSearchingBookings: cancelled,
    };
  }

  async reactivateUser(
    adminId: string,
    userId: string,
    context: SessionContext = {},
  ): Promise<AdminDirectorySuspendResponse> {
    const [user] = await this.db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw ApiException.notFound('User not found');
    if (user.status === 'active') {
      return {
        subjectId: userId,
        subjectType: 'user',
        status: 'active',
        cancelledSearchingBookings: 0,
      };
    }

    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          status: 'active',
          suspendedAt: null,
          suspendedBy: null,
          suspensionReason: null,
          updatedAt: now,
        })
        .where(eq(users.id, userId));
      await this.audit.record(
        {
          adminId,
          action: 'user.reactivate',
          subjectType: 'user',
          subjectId: userId,
          before: { status: user.status },
          after: { status: 'active' },
          reason: null,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        },
        { tx },
      );
    });

    return {
      subjectId: userId,
      subjectType: 'user',
      status: 'active',
      cancelledSearchingBookings: 0,
    };
  }

  /**
   * Cancels the user's `searching` bookings — fee-free by construction (no fee
   * policy runs here at all) — and tells any driver holding an offer through
   * the A12 queue job. One bad booking must not block the rest of the
   * suspension: each is independently attempted and failures are logged.
   */
  private async cancelSearchingBookings(adminId: string, userId: string): Promise<number> {
    const rows = await this.db
      .select({ id: bookings.id, driverId: bookings.driverId })
      .from(bookings)
      .where(and(eq(bookings.userId, userId), eq(bookings.status, 'searching')));

    let cancelled = 0;
    for (const booking of rows) {
      try {
        const result = await this.db.transaction((tx) =>
          this.machine.transition(tx, {
            bookingId: booking.id,
            to: 'cancelled',
            actor: 'admin',
            note: 'Customer account suspended',
          }),
        );
        await this.machine.announce(result);
        await this.queue.enqueue(
          'dispatch.revoke',
          {
            bookingId: booking.id,
            reason: 'cancelled',
            holderDriverId: booking.driverId ?? undefined,
          },
          { jobId: `revoke-${booking.id}` },
        );
        cancelled += 1;
      } catch (error) {
        this.logger.warn(`suspend cancel failed for ${booking.id}: ${String(error)}`);
      }
    }
    return cancelled;
  }
}
