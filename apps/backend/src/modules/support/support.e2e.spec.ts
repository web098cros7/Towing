import type { INestApplication } from '@nestjs/common';
import {
  adminSupportTicketDetailSchema,
  adminSupportTicketsResponseSchema,
  supportTicketCreateResponseSchema,
  supportTicketDetailSchema,
  supportTicketsResponseSchema,
} from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions, notificationEvents, notifications } from '../../db/schema';
import { supportTicketEvents, supportTickets } from '../../db/schema/support';
import {
  adminAuthHeaderFor,
  authHeaderFor,
  createTestApp,
  customerAuthHeaderFor,
  driverAuthHeaderFor,
} from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedAdmin,
  seedCustomer,
  seedDriver,
  seedFleet,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { seedBooking } from '../../test/fixtures';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

/**
 * W15 — support tickets (§9.4.12), backend.
 *
 * The phase's stated verification, in its own words: "a requester can only
 * read their own tickets; internal notes never appear in a requester payload;
 * status transitions audited; role matrix". The internal-note tests scan the
 * SERIALISED requester payloads rather than checking known fields — the
 * realistic leak is a future field carrying the body, and a field-level
 * assertion would not see it.
 */
describe('support tickets (/v1/support + /v1/admin/support, W15)', () => {
  let app: INestApplication;
  let db: TestDatabase;

  let customerId: string;
  let customerAuth: string;
  let otherCustomerAuth: string;
  let driverAuth: string;
  let fleetAuth: string;
  let fleetId: string;
  let opsId: string;
  let opsAuth: string;
  let supportAuth: string;
  let financeAuth: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();

    customerId = await seedCustomer(db, 'Meera Nair');
    customerAuth = await customerAuthHeaderFor(app, { userId: customerId });
    otherCustomerAuth = await customerAuthHeaderFor(app, {
      userId: await seedCustomer(db, 'Other Customer'),
    });

    const driverId = await seedDriver(db, { name: 'Kiran' });
    driverAuth = await driverAuthHeaderFor(app, { driverId });

    const fleet = await seedFleet(db, 'Ticket Fleet');
    fleetId = fleet.fleetId;
    fleetAuth = await authHeaderFor(app, { userId: fleet.ownerId, fleetId });

    const ops = await seedAdmin(db, { subRole: 'operations' });
    opsId = ops.id;
    opsAuth = await adminAuthHeaderFor(app, { adminId: ops.id, subRole: 'operations' });
    supportAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'support' })).id,
      subRole: 'support',
    });
    financeAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'finance' })).id,
      subRole: 'finance',
    });
  });

  const createTicket = (auth: string, body: Record<string, unknown> = {}, expected = 201) =>
    request(app.getHttpServer())
      .post('/v1/support/tickets')
      .set('Authorization', auth)
      .send({
        category: 'booking',
        subject: 'Driver never arrived',
        body: 'I waited forty minutes and nobody came.',
        ...body,
      })
      .expect(expected);

  // -------------------------------------------------------------------------
  // The requester rail
  // -------------------------------------------------------------------------

  it('lets a customer raise a ticket and see it in the console queue', async () => {
    const res = await createTicket(customerAuth);
    const created = expectMatchesContract(supportTicketCreateResponseSchema, res.body);
    expect(created.reference).toMatch(/^TKT-[0-9A-F]{8}$/);
    expect(created.status).toBe('open');

    const queue = await request(app.getHttpServer())
      .get('/v1/admin/support/tickets')
      .set('Authorization', opsAuth)
      .expect(200);
    const parsed = expectMatchesContract(adminSupportTicketsResponseSchema, queue.body);
    expect(parsed.total).toBe(1);
    expect(parsed.items[0]!.reference).toBe(created.reference);
    expect(parsed.items[0]!.requesterName).toBe('Meera Nair');

    const mine = await request(app.getHttpServer())
      .get('/v1/support/tickets')
      .set('Authorization', customerAuth)
      .expect(200);
    const list = expectMatchesContract(supportTicketsResponseSchema, mine.body);
    expect(list.total).toBe(1);
    expect(list.items[0]!.id).toBe(created.ticketId);
  });

  it('serves all three requester realms, and a fleet files as the fleet', async () => {
    await createTicket(driverAuth);
    const fleetTicket = await createTicket(fleetAuth, {
      category: 'payment',
      subject: 'Payout not received',
      body: 'Our settlement for last week has not arrived.',
    });

    const [row] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, fleetTicket.body.ticketId));
    expect(row!.requesterType).toBe('fleet');
    expect(row!.requesterId).toBe(fleetId);
  });

  it('links a booking the requester owns and refuses somebody else’s', async () => {
    const mine = await seedBooking(db, { userId: customerId, status: 'paid' });
    const stranger = await seedBooking(db, {
      userId: await seedCustomer(db, 'Stranger'),
      status: 'paid',
    });

    await createTicket(customerAuth, { bookingId: mine });
    await createTicket(customerAuth, { bookingId: stranger }, 404);
  });

  // -------------------------------------------------------------------------
  // The leak rule
  // -------------------------------------------------------------------------

  it('NEVER leaks an internal note into a requester payload', async () => {
    const created = await createTicket(customerAuth);
    const ticketId = created.body.ticketId as string;

    const INTERNAL_SECRET = 'Internal only: refund approved by finance, do not promise it.';
    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/note`)
      .set('Authorization', opsAuth)
      .send({ body: INTERNAL_SECRET })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/message`)
      .set('Authorization', opsAuth)
      .send({ body: 'We are on it — a driver will call you within the hour.' })
      .expect(200);

    // The serialised payload is scanned, not just its known fields: the
    // realistic leak is a future field carrying the body.
    const requesterDetail = await request(app.getHttpServer())
      .get(`/v1/support/tickets/${ticketId}`)
      .set('Authorization', customerAuth)
      .expect(200);
    expect(JSON.stringify(requesterDetail.body)).not.toContain(INTERNAL_SECRET);
    const detail = expectMatchesContract(supportTicketDetailSchema, requesterDetail.body);
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages.every((message) => message.authorType !== 'system')).toBe(true);

    const requesterList = await request(app.getHttpServer())
      .get('/v1/support/tickets')
      .set('Authorization', customerAuth)
      .expect(200);
    expect(JSON.stringify(requesterList.body)).not.toContain(INTERNAL_SECRET);

    // The console DOES see it, marked internal.
    const adminDetail = await request(app.getHttpServer())
      .get(`/v1/admin/support/tickets/${ticketId}`)
      .set('Authorization', opsAuth)
      .expect(200);
    const consoleView = expectMatchesContract(adminSupportTicketDetailSchema, adminDetail.body);
    const internal = consoleView.messages.find((message) => message.visibility === 'internal');
    expect(internal?.body).toBe(INTERNAL_SECRET);
  });

  it('scopes a requester to their own tickets', async () => {
    const created = await createTicket(customerAuth);
    const ticketId = created.body.ticketId as string;

    await request(app.getHttpServer())
      .get(`/v1/support/tickets/${ticketId}`)
      .set('Authorization', otherCustomerAuth)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/v1/support/tickets/${ticketId}/messages`)
      .set('Authorization', otherCustomerAuth)
      .send({ body: 'Hijack attempt' })
      .expect(404);

    const list = await request(app.getHttpServer())
      .get('/v1/support/tickets')
      .set('Authorization', otherCustomerAuth)
      .expect(200);
    expect(list.body.total).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Workflow
  // -------------------------------------------------------------------------

  it('answers a requester reply on pending_requester and refuses one on resolved', async () => {
    const created = await createTicket(customerAuth);
    const ticketId = created.body.ticketId as string;

    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', opsAuth)
      .send({ status: 'pending_requester', note: 'Which driver was assigned?' })
      .expect(200);

    const reply = await request(app.getHttpServer())
      .post(`/v1/support/tickets/${ticketId}/messages`)
      .set('Authorization', customerAuth)
      .send({ body: 'It was KA-01-AB-1234.' })
      .expect(200);
    expect(reply.body.status).toBe('in_progress');

    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', opsAuth)
      .send({ status: 'resolved', note: 'Driver was reassigned.' })
      .expect(200);

    const refused = await request(app.getHttpServer())
      .post(`/v1/support/tickets/${ticketId}/messages`)
      .set('Authorization', customerAuth)
      .send({ body: 'Not happy.' })
      .expect(409);
    expect(refused.body.error.details.code).toBe('ticket_closed');
  });

  it('walks the status graph, refuses an illegal edge, and audits every move', async () => {
    const created = await createTicket(customerAuth);
    const ticketId = created.body.ticketId as string;

    // open → in_progress
    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', opsAuth)
      .send({ status: 'in_progress', priority: 'high' })
      .expect(200);

    // in_progress → closed is legal; closed → in_progress is not.
    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', opsAuth)
      .send({ status: 'closed', note: 'Spam.' })
      .expect(200);

    const illegal = await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', opsAuth)
      .send({ status: 'in_progress' })
      .expect(422);
    expect(illegal.body.error.details.code).toBe('ticket_transition_invalid');

    // A reopened resolve gets a FRESH stamp rather than keeping the old one.
    const second = await createTicket(customerAuth);
    const secondId = second.body.ticketId as string;
    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${secondId}/status`)
      .set('Authorization', opsAuth)
      .send({ status: 'resolved' })
      .expect(200);
    const resolvedAgain = await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${secondId}/status`)
      .set('Authorization', opsAuth)
      .send({ status: 'in_progress', note: 'Customer came back.' })
      .expect(200);
    expect(resolvedAgain.body.resolvedAt).toBeNull();

    const audits = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'ticket.status'));
    // Four legal moves across the two tickets; the refused edge wrote nothing.
    expect(audits).toHaveLength(4);

    const events = await db
      .select()
      .from(supportTicketEvents)
      .where(eq(supportTicketEvents.ticketId, ticketId));
    expect(events.filter((row) => row.kind === 'status_changed').length).toBeGreaterThanOrEqual(3);
  });

  it('assigns to me, stamps the first response, and audits both', async () => {
    const created = await createTicket(customerAuth);
    const ticketId = created.body.ticketId as string;

    const assigned = await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/assign`)
      .set('Authorization', opsAuth)
      .send({})
      .expect(200);
    expect(assigned.body.assignedAdminId).toBe(opsId);
    expect(assigned.body.assignedAdminName).toBe('Test Admin');

    const before = assigned.body.firstResponseAt;
    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/message`)
      .set('Authorization', opsAuth)
      .send({ body: 'On it.' })
      .expect(200);
    const afterFirst = await request(app.getHttpServer())
      .get(`/v1/admin/support/tickets/${ticketId}`)
      .set('Authorization', opsAuth)
      .expect(200);
    expect(afterFirst.body.firstResponseAt).not.toBeNull();

    // A SECOND reply must not move the clock.
    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/message`)
      .set('Authorization', opsAuth)
      .send({ body: 'Following up.' })
      .expect(200);
    const afterSecond = await request(app.getHttpServer())
      .get(`/v1/admin/support/tickets/${ticketId}`)
      .set('Authorization', opsAuth)
      .expect(200);
    expect(afterSecond.body.firstResponseAt).toBe(afterFirst.body.firstResponseAt);
    expect(before).toBeNull();

    const audits = await db.select().from(adminActions);
    const verbs = audits.map((row) => row.action).sort();
    expect(verbs).toEqual(['ticket.assign', 'ticket.message', 'ticket.message']);
  });

  it('notifies the requester on a public reply and on resolve, but never on a note', async () => {
    const created = await createTicket(customerAuth);
    const ticketId = created.body.ticketId as string;

    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/note`)
      .set('Authorization', opsAuth)
      .send({ body: 'Internal: checking the driver.' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/message`)
      .set('Authorization', opsAuth)
      .send({ body: 'We are checking with the driver.' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', opsAuth)
      .send({ status: 'resolved', note: 'Reassigned and completed.' })
      .expect(200);

    const emitted = await db.select().from(notificationEvents);
    expect(emitted.map((row) => row.event).sort()).toEqual(['support.reply', 'support.resolved']);

    // The requester's inbox (the bell) has both rows — resolved via the
    // subject's own type, because a customer reads their own notifications.
    const inbox = await db
      .select()
      .from(notifications)
      .where(eq(notifications.subjectId, customerId));
    expect(inbox.map((row) => row.event).sort()).toEqual(['support.reply', 'support.resolved']);
  });

  it('links a booking from the console and refuses an unknown one', async () => {
    const created = await createTicket(customerAuth);
    const ticketId = created.body.ticketId as string;
    const bookingId = await seedBooking(db, { userId: customerId, status: 'paid' });

    const linked = await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/link-booking`)
      .set('Authorization', opsAuth)
      .send({ bookingId })
      .expect(200);
    expect(linked.body.bookingId).toBe(bookingId);
    expect(linked.body.bookingCode).toBe(`TW-${bookingId.slice(0, 8).toUpperCase()}`);

    await request(app.getHttpServer())
      .post(`/v1/admin/support/tickets/${ticketId}/link-booking`)
      .set('Authorization', opsAuth)
      .send({ bookingId: '00000000-0000-4000-8000-0000000000ff' })
      .expect(404);
  });

  it('keeps finance out and lets support work the queue (§4.2)', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/support/tickets')
      .set('Authorization', financeAuth)
      .expect(403);
    await request(app.getHttpServer())
      .get('/v1/admin/support/tickets')
      .set('Authorization', supportAuth)
      .expect(200);

    // Requester rail is realm-gated; an admin token is not a requester.
    await request(app.getHttpServer())
      .get('/v1/support/tickets')
      .set('Authorization', opsAuth)
      .expect(403);
  });

  // -------------------------------------------------------------------------
  // Attachments (Figma 61 "Add photos", up to 3)
  // -------------------------------------------------------------------------

  describe('attachments', () => {
    const presign = (auth: string) =>
      request(app.getHttpServer())
        .post('/v1/support/tickets/attachments/presign')
        .set('Authorization', auth)
        .expect(200);

    it('presigns a key under the requester’s own namespace', async () => {
      const res = await presign(customerAuth);
      expect(typeof res.body.uploadUrl).toBe('string');
      expect(res.body.key).toMatch(
        new RegExp(`^support-attachments/${customerId}/att-`),
      );
      expect(typeof res.body.expiresAt).toBe('string');
    });

    it('stores a checked attachment and serves it back as a signed URL', async () => {
      const slot = await presign(customerAuth);
      const key = slot.body.key as string;

      const created = await createTicket(customerAuth, { attachments: [key] });
      const ticketId = created.body.ticketId as string;

      const detail = await request(app.getHttpServer())
        .get(`/v1/support/tickets/${ticketId}`)
        .set('Authorization', customerAuth)
        .expect(200);
      const parsed = expectMatchesContract(supportTicketDetailSchema, detail.body);
      const first = parsed.messages[0]!;
      expect(first.attachments).toHaveLength(1);
      expect(typeof first.attachments[0]).toBe('string');
      expect(first.attachments[0]!.startsWith('local://')).toBe(false);
    });

    it('refuses a key minted for another requester', async () => {
      const otherSlot = await presign(otherCustomerAuth);
      await createTicket(customerAuth, { attachments: [otherSlot.body.key] }, 403);
    });

    it('refuses more than three attachments', async () => {
      const slots = await Promise.all([
        presign(customerAuth),
        presign(customerAuth),
        presign(customerAuth),
        presign(customerAuth),
      ]);
      const keys = slots.map((slot) => slot.body.key as string);
      await createTicket(customerAuth, { attachments: keys }, 422);
    });
  });
});
