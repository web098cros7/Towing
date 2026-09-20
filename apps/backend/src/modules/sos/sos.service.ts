import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  AdminSosActionResponse,
  AdminSosBroadcastBody,
  AdminSosBroadcastResponse,
  AdminSosContactBody,
  AdminSosContactResponse,
  AdminSosCreateBody,
  AdminSosCreateResponse,
  AdminSosDetail,
  AdminSosNoteBody,
  AdminSosQuery,
  AdminSosResolveBody,
  AdminSosResponse,
  SosCancelResponse,
  SosContactChannelResult,
  SosCreateRequest,
  SosCreateResponse,
  SosSubjectType,
} from '@towing/api-contracts';
import { ENV, type Env } from '../../config/env';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { OpsEventsService } from '../../common/events/ops-events.service';
import { KillSwitchService } from '../../common/killswitch/killswitch.service';
import { NotificationService } from '../../common/notifications/notification.service';
import { TEMPLATES } from '../../common/notifications/template-catalog';
import { TELEPHONY, type TelephonyPort } from '../../common/telephony/telephony.port';
import { DB, type Database } from '../../db/db.module';
import { sosAlertContacts, sosAlertEvents, sosAlerts } from '../../db/schema/sos';
import { emergencyContacts } from '../../db/schema/users';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { SessionContext } from '../auth/token.service';
import { DriverCandidatesRepo } from '../driver-presence/driver-candidates.repo';
import { ZoneResolverService } from '../pricing/zone-resolver.service';
import type { SubjectSnapshot } from './sos.repo';
import { SosRepo } from './sos.repo';

/** Who raised an alert, derived from the JWT realm — never from a path param. */
export interface SosRequester {
  subjectType: SosSubjectType;
  subjectId: string;
}

/**
 * W14's SOS (§13) — the safety slice.
 *
 * THREE THINGS THIS SERVICE IS RESPONSIBLE FOR, in this order:
 *
 *  1. **A trigger writes the incident.** The alert row, the contact SNAPSHOT
 *     and the first timeline events land in one transaction; the fan-out
 *     (`sos.triggered` to the contacts, `sos.ops_alert` to the on-call pool)
 *     and the realtime `sos:alert` publish happen after it commits. A panic
 *     tap must never be lost because a vendor was slow.
 *  2. **One open alert per subject.** The partial unique index is the rule, and
 *     the service treats a losing insert as "the same incident" — it records a
 *     duplicate `triggered` event, re-pings the console, and does NOT message
 *     the contacts twice.
 *  3. **Every operator step is a timeline event.** Acknowledge (idempotent),
 *     note, contact, resolve, broadcast — each writes `sos_alert_events` and an
 *     `admin_actions` row, so §13's "full timeline" is always reconstructable.
 *
 * THE EXTERNAL BLOCKS ARE STATED, NOT HIDDEN: SMS cannot send until MSG91/DLT
 * registration lands, WhatsApp awaits template approval, and Exotel has no
 * account (the direct-dial fallback answers with `masked: false`). The snapshot's
 * `notifiedChannels` records what the fan-out could actually attempt, and the
 * console says so.
 */
@Injectable()
export class SosService {
  private readonly logger = new Logger(SosService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(TELEPHONY) private readonly telephony: TelephonyPort,
    private readonly repo: SosRepo,
    private readonly notifications: NotificationService,
    private readonly opsEvents: OpsEventsService,
    private readonly killSwitch: KillSwitchService,
    private readonly candidates: DriverCandidatesRepo,
    private readonly zones: ZoneResolverService,
    private readonly audit: AdminAuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Requester rail: raise + cancel
  // -------------------------------------------------------------------------

  async raise(requester: SosRequester, body: SosCreateRequest): Promise<SosCreateResponse> {
    const subject = await this.requireSubject(requester);
    const bookingId = await this.resolveBooking(requester, body.bookingId);

    // Standalone mode (G11): enabled by default, and its switch is stored
    // inverted so an outage leaves this path working.
    if (!bookingId && !(await this.killSwitch.isSosStandaloneEnabled())) {
      throw ApiException.validation('Standalone SOS is currently disabled', {
        code: 'sos_standalone_disabled',
      });
    }

    return this.createIncident({
      requester,
      subject,
      source: 'app',
      bookingId,
      lat: body.lat,
      lng: body.lng,
      accuracyM: body.accuracyM ?? null,
      note: null,
      noteActor: null,
    });
  }

  async cancel(requester: SosRequester, alertId: string): Promise<SosCancelResponse> {
    const alert = await this.repo.alertById(alertId);
    if (
      !alert ||
      alert.subjectId !== requester.subjectId ||
      alert.subjectType !== requester.subjectType
    ) {
      // Not-found rather than forbidden: whether somebody else's alert exists
      // is not this caller's business.
      throw ApiException.notFound('Alert not found');
    }

    if (alert.status === 'cancelled') {
      // Idempotent: a double-tapped undo is the normal case for this button.
      return { alertId, status: 'cancelled', cancelledAt: alert.updatedAt };
    }
    if (alert.status !== 'triggered') {
      throw ApiException.conflict('This alert can no longer be cancelled', {
        code: 'sos_alert_closed',
      });
    }

    const ageSeconds = (Date.now() - Date.parse(alert.createdAt)) / 1000;
    if (ageSeconds > this.env.SOS_CANCEL_GRACE_SECONDS) {
      throw ApiException.conflict('The cancel window has passed', {
        code: 'sos_cancel_expired',
        graceSeconds: this.env.SOS_CANCEL_GRACE_SECONDS,
      });
    }

    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(sosAlerts)
        .set({ status: 'cancelled', updatedAt: now })
        .where(and(eq(sosAlerts.id, alertId), eq(sosAlerts.status, 'triggered')));
      await tx.insert(sosAlertEvents).values({
        alertId,
        kind: 'cancelled',
        actorType: 'subject',
        actorId: requester.subjectId,
        data: { ageSeconds: Math.round(ageSeconds) },
      });
    });

    return { alertId, status: 'cancelled', cancelledAt: now.toISOString() };
  }

  // -------------------------------------------------------------------------
  // Ops rail: raise on a caller's behalf
  // -------------------------------------------------------------------------

  /**
   * `POST /v1/admin/sos` — an operator raising an alert from a phone call
   * (`source: 'ops'`). This is what keeps the console useful before the mobile
   * SOS button exists, and it is why the endpoint accepts a position: the
   * caller knows where they are better than any column does.
   */
  async raiseByOps(
    adminId: string,
    body: AdminSosCreateBody,
    context: SessionContext,
  ): Promise<AdminSosCreateResponse> {
    const subject = await this.repo.findSubject(body.subjectType, body.subjectId);
    if (!subject) throw ApiException.notFound('Subject not found');

    const lat = body.lat ?? subject.lat;
    const lng = body.lng ?? subject.lng;
    if (lat === null || lng === null) {
      throw ApiException.validation(
        'No known location for this subject — pass the coordinates from the call',
        { code: 'sos_location_unknown' },
      );
    }

    let bookingId: string | null = null;
    if (body.bookingId) {
      const owned = await this.repo.findOwnedBooking(
        body.subjectType,
        body.subjectId,
        body.bookingId,
      );
      if (!owned) throw ApiException.notFound('Booking not found');
      bookingId = owned.id;
    } else {
      bookingId = (await this.repo.findActiveBooking(body.subjectType, body.subjectId))?.id ?? null;
    }

    const result = await this.createIncident({
      requester: { subjectType: body.subjectType, subjectId: body.subjectId },
      subject,
      source: 'ops',
      bookingId,
      lat,
      lng,
      accuracyM: null,
      note: body.note ?? null,
      noteActor: adminId,
    });

    await this.audit.record({
      adminId,
      action: 'sos.create',
      subjectType: 'sos_alert',
      subjectId: result.alertId,
      after: {
        source: 'ops',
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        replayed: result.replayed,
      },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { alertId: result.alertId, status: result.status, replayed: result.replayed };
  }

  // -------------------------------------------------------------------------
  // Ops rail: queue, detail, workflow
  // -------------------------------------------------------------------------

  async list(query: AdminSosQuery): Promise<AdminSosResponse> {
    const { items, total } = await this.repo.list(query);
    return { items, page: query.page, limit: query.limit, total };
  }

  async detail(id: string): Promise<AdminSosDetail> {
    const alert = await this.repo.alertById(id);
    if (!alert) throw ApiException.notFound('Alert not found');
    const [contacts, events] = await Promise.all([
      this.repo.contactsFor(id),
      this.repo.eventsFor(id),
    ]);
    return { ...alert, contacts, events };
  }

  /**
   * Idempotent by design: a second acknowledge returns the FIRST one's values
   * and writes nothing. Two operators both reacting to the same page is the
   * normal case, not an error.
   */
  async acknowledge(
    adminId: string,
    id: string,
    context: SessionContext,
  ): Promise<AdminSosActionResponse> {
    const alert = await this.repo.alertById(id);
    if (!alert) throw ApiException.notFound('Alert not found');

    if (alert.status === 'acknowledged') {
      return {
        alertId: id,
        status: 'acknowledged',
        at: alert.acknowledgedAt ?? alert.updatedAt,
      };
    }
    if (alert.status !== 'triggered') {
      throw ApiException.conflict('This alert is already closed', { code: 'sos_alert_closed' });
    }

    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(sosAlerts)
        .set({
          status: 'acknowledged',
          acknowledgedBy: adminId,
          acknowledgedAt: now,
          updatedAt: now,
        })
        // Conditional so two concurrent acknowledges cannot overwrite each
        // other — the loser re-reads and reports the winner's stamp.
        .where(and(eq(sosAlerts.id, id), eq(sosAlerts.status, 'triggered')))
        .returning({ id: sosAlerts.id });

      if (rows.length === 0) return false;

      await tx.insert(sosAlertEvents).values({
        alertId: id,
        kind: 'acknowledged',
        actorType: 'admin',
        actorId: adminId,
      });
      return true;
    });

    if (!updated) {
      const raced = await this.repo.alertById(id);
      if (!raced) throw ApiException.notFound('Alert not found');
      if (raced.status === 'acknowledged') {
        return { alertId: id, status: 'acknowledged', at: raced.acknowledgedAt ?? raced.updatedAt };
      }
      throw ApiException.conflict('This alert is already closed', { code: 'sos_alert_closed' });
    }

    await this.audit.record({
      adminId,
      action: 'sos.acknowledge',
      subjectType: 'sos_alert',
      subjectId: id,
      before: { status: 'triggered' },
      after: { status: 'acknowledged', acknowledgedAt: now.toISOString() },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { alertId: id, status: 'acknowledged', at: now.toISOString() };
  }

  async note(
    adminId: string,
    id: string,
    body: AdminSosNoteBody,
    context: SessionContext,
  ): Promise<AdminSosActionResponse> {
    const alert = await this.repo.alertById(id);
    if (!alert) throw ApiException.notFound('Alert not found');
    if (alert.status === 'cancelled') {
      throw ApiException.conflict('This alert was cancelled', { code: 'sos_alert_closed' });
    }

    const now = new Date();
    await this.db.insert(sosAlertEvents).values({
      alertId: id,
      kind: 'note',
      actorType: 'admin',
      actorId: adminId,
      note: body.note,
    });

    await this.audit.record({
      adminId,
      action: 'sos.note',
      subjectType: 'sos_alert',
      subjectId: id,
      after: { note: body.note },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { alertId: id, status: alert.status, at: now.toISOString() };
  }

  /**
   * Opens the call leg through the telephony port and records it. The port
   * never throws for a vendor outage — `masked: false` means the number
   * returned is a real personal number, and the console must say so before
   * anyone dials.
   */
  async contact(
    adminId: string,
    id: string,
    body: AdminSosContactBody,
    context: SessionContext,
  ): Promise<AdminSosContactResponse> {
    const alert = await this.repo.alertById(id);
    if (!alert) throw ApiException.notFound('Alert not found');
    if (alert.status === 'cancelled') {
      throw ApiException.conflict('This alert was cancelled', { code: 'sos_alert_closed' });
    }

    const contacts = await this.repo.contactsFor(id);
    let selected = contacts[0];
    if (body.contactId) {
      const found = contacts.find((contact) => contact.id === body.contactId);
      if (!found) throw ApiException.notFound('Contact not found on this alert');
      selected = found;
    }

    const target = selected?.phone ?? alert.subjectMobile ?? null;

    const call = await this.telephony.maskedNumber({
      // The binding scope: the booking when the alert has one, otherwise the
      // alert itself — a masked binding is scoped to a conversation, and this
      // incident IS the conversation.
      bookingId: alert.bookingId ?? alert.id,
      // `from: 'driver'` is the leg that receives `customerMobile` (the
      // dialler wants the OTHER party's number — see `DirectDialAdapter`).
      from: 'driver',
      customerMobile: target,
      driverMobile: null,
    });

    await this.db.insert(sosAlertEvents).values({
      alertId: id,
      kind: 'contacted',
      actorType: 'admin',
      actorId: adminId,
      data: {
        contactId: selected?.id ?? null,
        masked: call.masked,
        dialNumber: call.dialNumber,
        reference: call.reference,
      },
    });

    await this.audit.record({
      adminId,
      action: 'sos.contact',
      subjectType: 'sos_alert',
      subjectId: id,
      after: { contactId: selected?.id ?? null, masked: call.masked },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      alertId: id,
      dialNumber: call.dialNumber,
      masked: call.masked,
      reference: call.reference,
    };
  }

  /**
   * Resolve is idempotent too — a double-clicked "Resolved" in an emergency
   * UI must not 409 at the operator. The FIRST resolution is the one that
   * sticks.
   */
  async resolve(
    adminId: string,
    id: string,
    body: AdminSosResolveBody,
    context: SessionContext,
  ): Promise<AdminSosActionResponse> {
    const alert = await this.repo.alertById(id);
    if (!alert) throw ApiException.notFound('Alert not found');

    if (alert.status === 'resolved') {
      return { alertId: id, status: 'resolved', at: alert.resolvedAt ?? alert.updatedAt };
    }
    if (alert.status === 'cancelled') {
      throw ApiException.conflict('This alert was cancelled', { code: 'sos_alert_closed' });
    }

    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(sosAlerts)
        .set({
          status: 'resolved',
          resolvedBy: adminId,
          resolvedAt: now,
          resolution: body.resolution,
          updatedAt: now,
        })
        .where(and(eq(sosAlerts.id, id), eq(sosAlerts.status, alert.status)))
        .returning({ id: sosAlerts.id });

      if (rows.length === 0) return false;

      await tx.insert(sosAlertEvents).values({
        alertId: id,
        kind: 'resolved',
        actorType: 'admin',
        actorId: adminId,
        note: body.resolution,
      });
      return true;
    });

    if (!updated) {
      const raced = await this.repo.alertById(id);
      if (!raced) throw ApiException.notFound('Alert not found');
      if (raced.status === 'resolved') {
        return { alertId: id, status: 'resolved', at: raced.resolvedAt ?? raced.updatedAt };
      }
      throw ApiException.conflict('This alert was cancelled', { code: 'sos_alert_closed' });
    }

    await this.audit.record({
      adminId,
      action: 'sos.resolve',
      subjectType: 'sos_alert',
      subjectId: id,
      before: { status: alert.status },
      after: { status: 'resolved', resolution: body.resolution },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { alertId: id, status: 'resolved', at: now.toISOString() };
  }

  /**
   * G12's broadcast — ALWAYS an explicit operator decision, never a rule.
   * Reaches the online drivers the candidate store would consider, capped by
   * the operator's radius/limit (or the env defaults).
   */
  async broadcast(
    adminId: string,
    id: string,
    body: AdminSosBroadcastBody,
    context: SessionContext,
  ): Promise<AdminSosBroadcastResponse> {
    const alert = await this.repo.alertById(id);
    if (!alert) throw ApiException.notFound('Alert not found');
    if (alert.status === 'cancelled') {
      throw ApiException.conflict('This alert was cancelled', { code: 'sos_alert_closed' });
    }

    const radiusKm = body.radiusKm ?? this.env.SOS_BROADCAST_RADIUS_KM;
    const limit = body.limit ?? this.env.SOS_BROADCAST_LIMIT;
    const centre = { lat: alert.lat, lng: alert.lng };

    const zone = await this.zones.resolve(centre);
    const { candidates, degraded } = await this.candidates.searchWithFallback({
      zoneId: zone?.id ?? null,
      centre,
      radiusKm,
      limit,
    });
    const driverIds = candidates.map((candidate) => candidate.driverId);

    if (driverIds.length > 0) {
      try {
        await this.notifications.emit('sos.broadcast', {
          alertId: id,
          driverIds,
          lat: alert.lat,
          lng: alert.lng,
          radiusKm,
        });
      } catch (error) {
        // Best-effort like every other emit: the event row and the timeline
        // are the record, and a notification failure must not fail the action.
        this.logger.error(`sos.broadcast emit failed: ${message(error)}`);
      }
    }

    await this.db.insert(sosAlertEvents).values({
      alertId: id,
      kind: 'broadcast',
      actorType: 'admin',
      actorId: adminId,
      data: { drivers: driverIds.length, radiusKm, degraded },
    });

    await this.audit.record({
      adminId,
      action: 'sos.broadcast',
      subjectType: 'sos_alert',
      subjectId: id,
      after: { drivers: driverIds.length, radiusKm },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { alertId: id, notified: driverIds.length, radiusKm };
  }

  // -------------------------------------------------------------------------
  // The incident itself
  // -------------------------------------------------------------------------

  private async requireSubject(requester: SosRequester): Promise<SubjectSnapshot> {
    const subject = await this.repo.findSubject(requester.subjectType, requester.subjectId);
    if (!subject) throw ApiException.notFound('Account not found');
    return subject;
  }

  private async resolveBooking(
    requester: SosRequester,
    bookingId: string | undefined,
  ): Promise<string | null> {
    if (bookingId) {
      const owned = await this.repo.findOwnedBooking(
        requester.subjectType,
        requester.subjectId,
        bookingId,
      );
      if (!owned) throw ApiException.notFound('Booking not found');
      return owned.id;
    }
    const active = await this.repo.findActiveBooking(requester.subjectType, requester.subjectId);
    return active?.id ?? null;
  }

  /**
   * One path for both rails (`app` and `ops`): replay when an incident is
   * already open, otherwise write the alert + snapshot + opening events in one
   * transaction and fan out after it commits.
   */
  private async createIncident(input: {
    requester: SosRequester;
    subject: SubjectSnapshot;
    source: 'app' | 'ops';
    bookingId: string | null;
    lat: number;
    lng: number;
    accuracyM: number | null;
    note: string | null;
    noteActor: string | null;
  }): Promise<SosCreateResponse> {
    const { requester, subject } = input;
    const existing = await this.repo.openAlertForSubject(
      requester.subjectType,
      requester.subjectId,
    );
    if (existing) {
      return this.replay(existing.id, existing.status, existing.createdAt, input);
    }

    try {
      const created = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(sosAlerts)
          .values({
            subjectType: requester.subjectType,
            subjectId: requester.subjectId,
            bookingId: input.bookingId,
            lat: input.lat,
            lng: input.lng,
            accuracyM: input.accuracyM,
            source: input.source,
            status: 'triggered',
          })
          .returning({ id: sosAlerts.id, createdAt: sosAlerts.createdAt });

        if (!row) throw new Error('sos_alerts insert returned no row');

        await tx.insert(sosAlertEvents).values({
          alertId: row.id,
          kind: 'triggered',
          actorType: input.source === 'ops' ? 'admin' : 'subject',
          actorId: input.noteActor ?? requester.subjectId,
          data: {
            lat: input.lat,
            lng: input.lng,
            accuracyM: input.accuracyM,
            bookingId: input.bookingId,
            source: input.source,
          },
        });

        const contacts = await this.snapshotContacts(tx as unknown as Database, requester, row.id);
        if (contacts.length > 0) {
          await tx.insert(sosAlertEvents).values({
            alertId: row.id,
            kind: 'contacts_notified',
            actorType: 'system',
            data: {
              contacts: contacts.length,
              channels: contactChannelResults(),
            },
          });
        }

        // Written in the transaction as "fan-out requested"; the delivery
        // outcomes live in `notification_deliveries`, where every other
        // notification's outcomes live.
        await tx.insert(sosAlertEvents).values({
          alertId: row.id,
          kind: 'ops_alerted',
          actorType: 'system',
          data: { mailbox: this.env.SOS_OPS_EMAIL },
        });

        if (input.note && input.noteActor) {
          await tx.insert(sosAlertEvents).values({
            alertId: row.id,
            kind: 'note',
            actorType: 'admin',
            actorId: input.noteActor,
            note: input.note,
          });
        }

        return { alertId: row.id, createdAt: row.createdAt, contacts };
      });

      await this.publishAlert(created.alertId, requester, input, 'triggered', false);
      await this.fanOut(created.alertId, requester, subject, created.contacts, input);

      return {
        alertId: created.alertId,
        status: 'triggered',
        createdAt: created.createdAt.toISOString(),
        replayed: false,
      };
    } catch (error) {
      // The unique index fired: somebody (probably this person, a second ago)
      // already has an open alert. That is a replay, not a failure.
      if (isUniqueViolation(error)) {
        const raced = await this.repo.openAlertForSubject(
          requester.subjectType,
          requester.subjectId,
        );
        if (raced) return this.replay(raced.id, raced.status, raced.createdAt, input);
      }
      throw error;
    }
  }

  /**
   * A repeat tap while the incident is open: recorded on the timeline with the
   * fresh position, and the console is re-pinged so it flashes again — but the
   * contacts are NOT messaged twice and the snapshot is not rewritten.
   */
  private async replay(
    alertId: string,
    status: string,
    createdAt: Date,
    input: {
      requester: SosRequester;
      lat: number;
      lng: number;
      accuracyM: number | null;
      note: string | null;
      noteActor: string | null;
    },
  ): Promise<SosCreateResponse> {
    await this.db.insert(sosAlertEvents).values({
      alertId,
      kind: 'triggered',
      actorType: input.noteActor ? 'admin' : 'subject',
      actorId: input.noteActor ?? input.requester.subjectId,
      data: { duplicate: true, lat: input.lat, lng: input.lng, accuracyM: input.accuracyM },
    });

    await this.publishAlert(
      alertId,
      input.requester,
      { lat: input.lat, lng: input.lng, bookingId: null },
      status as SosCreateResponse['status'],
      true,
    );

    return {
      alertId,
      status: status as SosCreateResponse['status'],
      createdAt: createdAt.toISOString(),
      replayed: true,
    };
  }

  /**
   * The contact SNAPSHOT, taken inside the trigger transaction.
   *
   * The channel results are computed from the template catalog rather than
   * assumed: with `dltTemplateId` null the SMS adapter will refuse, and saying
   * so in the snapshot is the difference between "the contact was told" and
   * "the contact cannot be reached until DLT registration lands". That is the
   * designed degradation, recorded at the moment it mattered.
   */
  private async snapshotContacts(
    tx: Database,
    requester: SosRequester,
    alertId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    // A driver has no `emergency_contacts` rows today (that table is
    // user-scoped): a driver alert fans out to ops only. A real state, not a bug.
    if (requester.subjectType !== 'user') return [];

    const contacts = await tx
      .select({
        name: emergencyContacts.name,
        phone: emergencyContacts.phone,
        relation: emergencyContacts.relation,
      })
      .from(emergencyContacts)
      .where(eq(emergencyContacts.userId, requester.subjectId));

    if (contacts.length === 0) return [];

    const results = contactChannelResults();
    const inserted = await tx
      .insert(sosAlertContacts)
      .values(
        contacts.map((contact) => ({
          alertId,
          name: contact.name,
          phone: contact.phone,
          relation: contact.relation,
          notifiedChannels: results,
        })),
      )
      .returning({ id: sosAlertContacts.id, name: sosAlertContacts.name });

    return inserted;
  }

  private async fanOut(
    alertId: string,
    requester: SosRequester,
    subject: SubjectSnapshot,
    contacts: Array<{ id: string; name: string }>,
    input: { lat: number; lng: number },
  ): Promise<void> {
    const subjectLabel = subject.name ?? subject.mobile ?? 'A user';
    try {
      await this.notifications.emit('sos.triggered', {
        alertId,
        subjectType: requester.subjectType,
        subjectId: requester.subjectId,
        contacts,
        lat: input.lat,
        lng: input.lng,
      });
      await this.notifications.emit('sos.ops_alert', {
        alertId,
        subjectType: requester.subjectType,
        subjectId: requester.subjectId,
        subjectLabel,
        lat: input.lat,
        lng: input.lng,
        opsEmail: this.env.SOS_OPS_EMAIL,
      });
    } catch (error) {
      // The incident is durable; the fan-out is best-effort by design. A
      // notification failure must never un-raise an SOS.
      this.logger.error(`SOS fan-out failed for ${alertId}: ${message(error)}`);
    }
  }

  private async publishAlert(
    alertId: string,
    requester: SosRequester,
    input: { lat: number; lng: number; bookingId: string | null },
    status: SosCreateResponse['status'],
    duplicate: boolean,
  ): Promise<void> {
    // Warn-only inside `OpsEventsService`, like every ops publish — the
    // Redis channel is the fast path, the queue is the durable one.
    await this.opsEvents.publish({
      kind: 'sos_alert',
      alertId,
      subjectType: requester.subjectType,
      subjectId: requester.subjectId,
      bookingId: input.bookingId,
      lat: input.lat,
      lng: input.lng,
      status,
      duplicate,
    });
  }
}

/**
 * Per-channel feasibility at trigger time, read off the catalog. `ok: true`
 * means "handed to the spine", not "delivered" — delivery outcomes live in
 * `notification_deliveries`, and the console links both.
 */
function contactChannelResults(): SosContactChannelResult[] {
  const template = TEMPLATES.sos_triggered;
  return [
    {
      channel: 'sms',
      ok: template.dltTemplateId !== null,
      code: template.dltTemplateId === null ? 'dlt_template_missing' : null,
    },
    {
      channel: 'whatsapp',
      ok: template.waTemplateName !== null,
      code: template.waTemplateName === null ? 'wa_template_missing' : null,
    },
  ];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
