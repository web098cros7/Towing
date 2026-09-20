import type { INestApplication } from '@nestjs/common';
import {
  adminAdminsListResponseSchema,
  analyticsDriverResponseSchema,
  analyticsGeoResponseSchema,
  analyticsRevenueResponseSchema,
  analyticsSummaryResponseSchema,
  adminAuditListResponseSchema,
  adminBannersResponseSchema,
  adminBookingsResponseSchema,
  adminCommissionConfigSchema,
  adminCommissionImpactSchema,
  adminCommissionProposalSchema,
  adminCouponsResponseSchema,
  adminDeletionRequestsResponseSchema,
  adminDirectoryUsersResponseSchema,
  adminDirectoryZonesResponseSchema,
  adminDisputesResponseSchema,
  adminDispatchConfigSchema,
  adminDispatchInspectorListResponseSchema,
  adminDriversDirectoryResponseSchema,
  adminFinanceConfigSchema,
  adminFleetsResponseSchema,
  adminIdentitySchema,
  adminInvariantsResponseSchema,
  adminLedgerResponseSchema,
  adminNotesResponseSchema,
  adminNotificationDeliveriesResponseSchema,
  adminNotificationTemplatesResponseSchema,
  adminOpsActivityResponseSchema,
  adminOpsBadgesResponseSchema,
  adminOpsDashboardResponseSchema,
  adminOpsLiveResponseSchema,
  adminPendingDriversResponseSchema,
  adminPayoutSlaResponseSchema,
  adminPayoutsListResponseSchema,
  adminPricingConfigSchema,
  adminRetentionPoliciesResponseSchema,
  adminPricingHistoryEntrySchema,
  adminRefundsResponseSchema,
  adminSosResponseSchema,
  adminSupportTicketsResponseSchema,
  adminTransactionsResponseSchema,
  contentPagesResponseSchema,
  adminContentPagesResponseSchema,
  supportTicketsResponseSchema,
  adminSessionsResponseSchema,
  adminSuspensionRequestsResponseSchema,
  adminZonesResponseSchema,
  appConfigSchema,
  alertsListResponseSchema,
  bookingListResponseSchema,
  commissionHistoryEntrySchema,
  serviceCatalogResponseSchema,
  dashboardSummarySchema,
  driversListResponseSchema,
  earningsSummarySchema,
  fleetSettingsSchema,
  jobsListResponseSchema,
  payoutsListResponseSchema,
  positionsSnapshotSchema,
  publicBannersResponseSchema,
  reportResponseSchema,
  splitsListResponseSchema,
  trucksListResponseSchema,
} from '@towing/api-contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  adminAuthHeaderFor,
  authHeaderFor,
  createTestApp,
  customerAuthHeaderFor,
} from '../test/app';
import {
  seedAdmin,
  seedCustomer,
  seedDriver,
  seedFleet,
  seedPayoutAccount,
  setupTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../test/db';
import {
  adminActions,
  adminNotes,
  banners,
  bookingStatusHistory,
  commissionConfigHistory,
  commissionGuardrail,
  commissionProposals,
  coupons,
  deletionRequests,
  disputes,
  driverDocuments,
  drivers,
  notificationDeliveries,
  notificationEvents,
  payments,
  payouts,
  refunds,
  retentionPolicies,
  serviceZones,
  sosAlerts,
  supportTicketMessages,
  supportTickets,
  contentPages,
  suspensionRequests,
} from '../db/schema';
import {
  seedBooking,
  seedCustomerBooking,
  seedTruck,
  seedWalletWithLedger,
} from '../test/fixtures';
import { closeTestRedis, testRedis } from '../test/redis';
import { expectMatchesContract } from './contracts';
import { seedPricingFixtures } from '../modules/pricing/pricing.e2e.spec';
import { RETENTION_POLICY_DEFAULTS } from '../modules/privacy/retention';
import { TokenService } from '../modules/auth/token.service';
import { driverGeoKey } from '../redis/redis.constants';
import { eq } from 'drizzle-orm';

/**
 * Every fleet read endpoint, asserted against the schema its client parses.
 *
 * Until now nothing checked this in either direction: the backend built its
 * responses by hand and the console trusted them, with `@towing/api-contracts`
 * agreeing with both only because a human kept it so. A type is no help — the
 * DTOs are assembled from SQL rows through `as` casts and raw `db.execute`, and
 * an extra key is invisible to TypeScript by construction.
 *
 * One table rather than an assertion scattered through each module's spec, so
 * that reading this file tells you what is covered — and a completeness guard
 * below so the table cannot quietly rot as routes are added.
 */
/** `/fleet/reports` requires an explicit IST date range; any valid one will do. */
const RANGE = 'from=2026-01-01&to=2026-12-31';

/** W21's notes row is subject-scoped; the seed below writes this exact subject. */
const NOTES_SUBJECT_ID = '44444444-4444-4444-8444-444444444444';

describe('response contracts', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let auth: string;
  let customerAuth: string;
  let adminAuth: string;
  let fleetId: string;

  /**
   * `realm` selects which token the request carries. Absent means fleet — the
   * only realm this table covered until Phase 14 added customer read routes
   * and A1 added the admin console's eight.
   */
  const ROUTES: Array<{ path: string; schema: z.ZodType; realm?: 'fleet' | 'customer' | 'admin' }> =
    [
      { path: '/v1/fleet/dashboard', schema: dashboardSummarySchema },
      { path: '/v1/fleet/trucks', schema: trucksListResponseSchema },
      { path: '/v1/fleet/drivers', schema: driversListResponseSchema },
      { path: '/v1/fleet/jobs', schema: jobsListResponseSchema },
      { path: '/v1/fleet/alerts', schema: alertsListResponseSchema },
      { path: '/v1/fleet/earnings', schema: earningsSummarySchema },
      { path: '/v1/fleet/earnings/split', schema: splitsListResponseSchema },
      { path: '/v1/fleet/payouts', schema: payoutsListResponseSchema },
      { path: '/v1/fleet/settings', schema: fleetSettingsSchema },
      { path: '/v1/fleet/realtime/positions', schema: positionsSnapshotSchema },
      // All three arms of the discriminated union — a union is only as checked as
      // its least-exercised member.
      { path: `/v1/fleet/reports?groupBy=truck&${RANGE}`, schema: reportResponseSchema },
      { path: `/v1/fleet/reports?groupBy=driver&${RANGE}`, schema: reportResponseSchema },
      { path: `/v1/fleet/reports?groupBy=period&${RANGE}`, schema: reportResponseSchema },
      // Phase 14 — the customer realm's first entry in this table.
      { path: '/v1/services', schema: serviceCatalogResponseSchema, realm: 'customer' },
      // Phase 15. Seeded with a real trip below — an empty list matches almost
      // any schema, which is what makes an unseeded row in this table worthless.
      { path: '/v1/bookings', schema: bookingListResponseSchema, realm: 'customer' },
      // A1 — the admin console's eight, plus W2's admins list and W1's session
      // list. Super-admin satisfies every role set, so one token covers them all.
      {
        path: '/v1/admin/drivers/pending',
        schema: adminPendingDriversResponseSchema,
        realm: 'admin',
      },
      { path: '/v1/admin/drivers', schema: adminDriversDirectoryResponseSchema, realm: 'admin' },
      { path: '/v1/admin/fleets', schema: adminFleetsResponseSchema, realm: 'admin' },
      {
        path: '/v1/admin/directory/zones',
        schema: adminDirectoryZonesResponseSchema,
        realm: 'admin',
      },
      { path: '/v1/admin/finance/payouts', schema: adminPayoutsListResponseSchema, realm: 'admin' },
      { path: '/v1/admin/finance/config', schema: adminFinanceConfigSchema, realm: 'admin' },
      // W9 — the console's reads. The refunds collection has a processed
      // partial refund seeded below; the ledger feed has a real wallet leg;
      // the invariants panel's zeros are asserted, not assumed.
      {
        path: '/v1/admin/finance/transactions',
        schema: adminTransactionsResponseSchema,
        realm: 'admin',
      },
      { path: '/v1/admin/finance/ledger', schema: adminLedgerResponseSchema, realm: 'admin' },
      { path: '/v1/admin/finance/refunds', schema: adminRefundsResponseSchema, realm: 'admin' },
      {
        path: '/v1/admin/finance/invariants',
        schema: adminInvariantsResponseSchema,
        realm: 'admin',
      },
      {
        path: '/v1/admin/finance/payouts/sla',
        schema: adminPayoutSlaResponseSchema,
        realm: 'admin',
      },
      { path: '/v1/admin/pricing', schema: adminPricingConfigSchema, realm: 'admin' },
      // W10 — the version history reads `admin_actions` rows whose subject is
      // `pricing_config`; one is seeded below so this is not an empty-array row.
      {
        path: '/v1/admin/pricing/history',
        schema: z.array(adminPricingHistoryEntrySchema),
        realm: 'admin',
      },
      { path: '/v1/admin/commission', schema: adminCommissionConfigSchema, realm: 'admin' },
      // W11 — proposals (seeded below, so not an empty-array row) and the impact
      // preview, whose band rows always exist even with no bookings in window.
      {
        path: '/v1/admin/commission/proposals',
        schema: z.array(adminCommissionProposalSchema),
        realm: 'admin',
      },
      {
        path: '/v1/admin/commission/impact?bands=A:9,B:8,C:5&days=7',
        schema: adminCommissionImpactSchema,
        realm: 'admin',
      },
      // W12 — the app config, from both doors. The public one is `@Public()` by
      // design (a build that must force-upgrade cannot first authenticate); the
      // token here is simply ignored, which is itself worth pinning.
      { path: '/v1/app-config', schema: appConfigSchema, realm: 'customer' },
      { path: '/v1/admin/app-config', schema: appConfigSchema, realm: 'admin' },
      {
        path: '/v1/admin/commission/history',
        schema: z.array(commissionHistoryEntrySchema),
        realm: 'admin',
      },
      { path: '/v1/admin/dispatch-config', schema: adminDispatchConfigSchema, realm: 'admin' },
      // W13 — the zone list, non-empty because the ops fixture below seeds an
      // active zone (and `seedPricingFixtures` seeds the launch set beside it).
      { path: '/v1/admin/zones', schema: adminZonesResponseSchema, realm: 'admin' },
      { path: '/v1/admin/auth/me', schema: adminIdentitySchema, realm: 'admin' },
      { path: '/v1/admin/admins', schema: adminAdminsListResponseSchema, realm: 'admin' },
      // W1 §3.6. The session list renders refresh-token FAMILIES, so it needs a
      // real issued session — an empty list is exactly the vacuous row this
      // file's doctrine warns about. The fixture above mints one.
      { path: '/v1/admin/auth/sessions', schema: adminSessionsResponseSchema, realm: 'admin' },
      // W1 §3.5. Seeded with one audit row below for the same reason.
      { path: '/v1/admin/audit', schema: adminAuditListResponseSchema, realm: 'admin' },
      // W21 — subject-scoped by necessity; the subject id is seeded below and is
      // deliberately NOT a real driver: `admin_notes.subject_id` is FK-free.
      {
        path: `/v1/admin/notes?subjectType=driver&subjectId=${NOTES_SUBJECT_ID}`,
        schema: adminNotesResponseSchema,
        realm: 'admin',
      },
      // W3/W4 — the ops surface. Live is seeded below with an online driver,
      // an active booking and a zone (an empty list matches almost any schema);
      // activity is non-empty via the audit row above whenever Redis is empty.
      { path: '/v1/admin/ops/dashboard', schema: adminOpsDashboardResponseSchema, realm: 'admin' },
      { path: '/v1/admin/ops/activity', schema: adminOpsActivityResponseSchema, realm: 'admin' },
      { path: '/v1/admin/ops/badges', schema: adminOpsBadgesResponseSchema, realm: 'admin' },
      { path: '/v1/admin/ops/live', schema: adminOpsLiveResponseSchema, realm: 'admin' },
      // W5 — the inspector list. Seeded with a live search below; the
      // parameterised detail cannot sit in this static table and is excluded
      // (see EXCLUDED) with its contract asserted in
      // `admin-ops-dispatch.e2e.spec.ts`.
      {
        path: '/v1/admin/ops/dispatch',
        schema: adminDispatchInspectorListResponseSchema,
        realm: 'admin',
      },
      // W6 — the directory list and the suspension-request inbox. Users exist in
      // every fixture set; the request row is seeded below.
      { path: '/v1/admin/users', schema: adminDirectoryUsersResponseSchema, realm: 'admin' },
      {
        path: '/v1/admin/suspension-requests',
        schema: adminSuspensionRequestsResponseSchema,
        realm: 'admin',
      },
      // W8 — the bookings list and the dispute queue. Both are seeded below
      // with real rows: a booking that settled, and an open dispute on it.
      { path: '/v1/admin/bookings', schema: adminBookingsResponseSchema, realm: 'admin' },
      { path: '/v1/admin/disputes', schema: adminDisputesResponseSchema, realm: 'admin' },
      // W14 — the SOS queue, seeded below with one open alert. The
      // parameterised detail is EXCLUDED and asserted with
      // `expectMatchesContract(adminSosDetailSchema)` in `sos.e2e.spec.ts`.
      { path: '/v1/admin/sos', schema: adminSosResponseSchema, realm: 'admin' },
      // W15 — tickets + content, all seeded below. The public content read is
      // `@Public()`; the token rides along simply because this table always
      // sends one, and the route ignoring it is itself pinned here.
      { path: '/v1/support/tickets', schema: supportTicketsResponseSchema, realm: 'customer' },
      {
        path: '/v1/admin/support/tickets',
        schema: adminSupportTicketsResponseSchema,
        realm: 'admin',
      },
      { path: '/v1/content/faq', schema: contentPagesResponseSchema, realm: 'customer' },
      { path: '/v1/admin/content', schema: adminContentPagesResponseSchema, realm: 'admin' },
      // W16 — the promotions surface. One coupon and two live banners are
      // seeded below; the public carousel read is `@Public()` and the token
      // rides along for the same reason as the content row above. The
      // parameterised `/admin/coupons/:id/redemptions` is EXCLUDED and
      // asserted in `promotions-admin.e2e.spec.ts`.
      { path: '/v1/admin/coupons', schema: adminCouponsResponseSchema, realm: 'admin' },
      { path: '/v1/admin/banners', schema: adminBannersResponseSchema, realm: 'admin' },
      { path: '/v1/banners?audience=customer', schema: publicBannersResponseSchema, realm: 'customer' },
      // W17 — the analytics envelopes. As ENVELOPE checks: the numbers come
      // from the rollups and today's live compute, and the non-vacuous
      // assertions (rollup matches a live query, bands/grid non-empty) live in
      // `analytics.e2e.spec.ts` where a whole IST day is seeded by hand.
      { path: '/v1/admin/analytics/summary', schema: analyticsSummaryResponseSchema, realm: 'admin' },
      {
        path: '/v1/admin/analytics/marketplace',
        schema: analyticsSummaryResponseSchema,
        realm: 'admin',
      },
      { path: '/v1/admin/analytics/revenue', schema: analyticsRevenueResponseSchema, realm: 'admin' },
      { path: '/v1/admin/analytics/drivers', schema: analyticsDriverResponseSchema, realm: 'admin' },
      { path: '/v1/admin/analytics/geo', schema: analyticsGeoResponseSchema, realm: 'admin' },
      // W18 — the notification catalogue + delivery log. The delivery row is
      // seeded below so the log read is not the vacuous kind this file warns
      // about; the guarded test-send is a POST and lives in the module spec.
      {
        path: '/v1/admin/notifications/templates',
        schema: adminNotificationTemplatesResponseSchema,
        realm: 'admin',
      },
      {
        path: '/v1/admin/notifications/deliveries',
        schema: adminNotificationDeliveriesResponseSchema,
        realm: 'admin',
      },
      // W19 — the privacy queue and the retention schedule. One request is
      // seeded below and the policy rows migration 0033 ships are re-inserted
      // (this spec truncates every table). The parameterised detail is EXCLUDED
      // and contract-asserted in `privacy-erasure.e2e.spec.ts`.
      {
        path: '/v1/admin/privacy/deletion-requests',
        schema: adminDeletionRequestsResponseSchema,
        realm: 'admin',
      },
      {
        path: '/v1/admin/privacy/retention',
        schema: adminRetentionPoliciesResponseSchema,
        realm: 'admin',
      },
    ];

  beforeAll(async () => {
    db = await setupTestDatabase();
    await truncateAll();
    app = await createTestApp();

    // Real data, not an empty fleet: an empty list matches almost any schema,
    // so a fleet with nothing in it would make this whole file vacuous.
    const fleet = await seedFleet(db, 'Contract Fleet');
    fleetId = fleet.fleetId;
    auth = await authHeaderFor(app, { userId: fleet.ownerId, fleetId });

    await seedTruck(db, fleetId, { plate: 'KA-51-CT-0001' });
    const driverId = await seedDriver(db, { fleetId });
    const contractPaidBookingId = await seedBooking(db, {
      userId: fleet.ownerId,
      fleetId,
      driverId,
      status: 'paid',
    });
    await seedPayoutAccount(db, fleetId);

    // Phase 14's customer-realm row needs a customer token and a populated
    // catalogue — an empty `services` list would match its schema vacuously.
    const contractCustomer = await seedCustomer(db);
    customerAuth = await customerAuthHeaderFor(app, { userId: contractCustomer });
    await seedPricingFixtures(db);
    await seedBooking(db, { userId: contractCustomer, status: 'paid' });
    await seedWalletWithLedger(db, { ownerType: 'fleet', ownerId: fleetId }, [
      { type: 'fleet_share_credit', amount: '5000.00' },
    ]);

    // A1 — one super_admin satisfies all eight admin role sets. Every admin
    // row below is seeded non-empty on purpose: an empty response matches
    // almost any schema, which is what makes an unseeded row worthless.
    const superAdmin = await seedAdmin(db, { subRole: 'super_admin' });
    adminAuth = await adminAuthHeaderFor(app, { adminId: superAdmin.id, subRole: 'super_admin' });
    // W1 §3.6 — `adminAuthHeaderFor` only signs a token; the sessions list
    // reads `refresh_tokens`, so issue one real family for this admin.
    await app.get(TokenService).issueSession({ subjectId: superAdmin.id, realm: 'admin' });

    // Pending KYC driver with a real document (thumbnailUrl is a signed GET).
    const pendingDriverId = await seedDriver(db, {
      kycStatus: 'pending',
      name: 'Contract Pending',
    });
    await db.insert(driverDocuments).values({
      driverId: pendingDriverId,
      docType: 'license',
      fileUrl: `local://driver-documents/${pendingDriverId}/license.png`,
      status: 'pending',
    });

    // Queued payout with a linked destination so ownerName/bank fields populate.
    const payoutDriverId = await seedDriver(db, { name: 'Contract Payout Driver' });
    await seedWalletWithLedger(db, { ownerType: 'driver', ownerId: payoutDriverId }, [
      { type: 'fare_credit', amount: '50000.00' },
    ]);
    await seedPayoutAccount(db, payoutDriverId, { ownerType: 'driver' });
    await db.insert(payouts).values({
      ownerId: payoutDriverId,
      ownerType: 'driver',
      amount: '20000.00',
      status: 'requested',
      approvalState: 'pending_approval',
      idempotencyKey: `contract-test-payout-${payoutDriverId}`,
      provider: 'dev',
    });

    // Commission-history genesis row — oldPct is null only for seeded rows.
    await db.insert(commissionConfigHistory).values({
      band: 'A',
      oldPct: null,
      newPct: '10.00',
      changedBy: superAdmin.id,
      reason: 'contract coverage seed',
    });

    // W11 — one open proposal so the proposals row above is non-empty. (The
    // guardrail row comes from `seedPricingFixtures` above, which mirrors the
    // migration's own seed.)
    await db.insert(commissionProposals).values({
      band: 'B',
      pct: '7.50',
      proposedBy: superAdmin.id,
      reason: 'contract coverage seed',
    });

    // W1 §3.5 — one audit row so the feed row above is non-empty (and the
    // super admin's own-row filter would not hide it either way).
    await db.insert(adminActions).values({
      adminId: superAdmin.id,
      action: 'pricing.edit',
      subjectType: 'pricing',
      before: { bandAPct: '12.00' },
      after: { bandAPct: '12.50' },
      reason: 'contract coverage seed',
    });

    // W10 — the same table feeds `GET /admin/pricing/history`, which filters on
    // the REAL subject type the pricing write path records (`pricing_config`;
    // the seed row above is older fixture noise and deliberately unmatched).
    await db.insert(adminActions).values({
      adminId: superAdmin.id,
      action: 'pricing.update',
      subjectType: 'pricing_config',
      before: { charges: { nightPct: 15 } },
      after: { charges: { nightPct: 18 } },
      reason: 'contract coverage seed',
    });

    // W21 — one note on the subject the notes row above queries.
    await db.insert(adminNotes).values({
      subjectType: 'driver',
      subjectId: NOTES_SUBJECT_ID,
      adminId: superAdmin.id,
      body: 'contract coverage note',
    });

    // W3/W4 — the ops fixture set: an active zone, an online KYC-approved
    // driver (Postgres decides the live map's drivers), a position in Redis
    // (Redis decides where), and an active booking to draw — plus the history
    // rows that give the dashboard's fill-rate arithmetic something to count.
    const [opsZone] = await db
      .insert(serviceZones)
      .values({
        name: 'Contract Ops Zone',
        area: 'SRID=4326;POLYGON((77.45 12.80,77.80 12.80,77.80 13.15,77.45 13.15,77.45 12.80))',
        surgeBand: 'standard',
      })
      .returning({ id: serviceZones.id });
    const opsDriverId = await seedDriver(db, { name: 'Contract Ops Driver' });
    await db
      .update(drivers)
      .set({ isOnline: true, lastPingAt: new Date(), currentZoneId: opsZone!.id })
      .where(eq(drivers.id, opsDriverId));
    await testRedis().geoadd(driverGeoKey(opsZone!.id), 77.5946, 12.9716, opsDriverId);

    const opsBookingId = await seedBooking(db, {
      userId: contractCustomer,
      status: 'assigned',
      driverId: opsDriverId,
      pickupAddress: 'Contract Ops Pickup',
    });
    await db.insert(bookingStatusHistory).values([
      { bookingId: opsBookingId, status: 'searching' },
      { bookingId: opsBookingId, status: 'assigned' },
    ]);

    // W5 — one live search for the inspector list row above (the list would be
    // an empty array without it, which matches almost any schema). Its own
    // customer: `contractCustomer` already owns the assigned ops booking above,
    // and `uq_bookings_one_active_per_user` allows only one active booking.
    await seedCustomerBooking(db, { status: 'searching' });

    // W6 — one open suspension request so the inbox row above is non-empty.
    await db.insert(suspensionRequests).values({
      subjectType: 'driver',
      subjectId: pendingDriverId,
      requestedBy: superAdmin.id,
      reason: 'contract coverage seed',
    });

    // W8 — one open dispute so the queue row above is non-empty. The paid
    // booking it names is the one seeded for the fleet realm; `opened_from`
    // is `paid`, which is the origin the money exits are defined for.
    await db.insert(disputes).values({
      bookingId: contractPaidBookingId,
      openedByType: 'admin',
      openedById: superAdmin.id,
      reasonCode: 'overcharge',
      description: 'contract coverage dispute',
      status: 'open',
      openedFromStatus: 'paid',
    });

    // W9 — the console reads need real rows, or their contract entries are the
    // vacuous kind this file warns about. A captured payment on the paid
    // booking the dispute names, a processed PARTIAL refund against it (which
    // also keeps `payments.refunded_amount` honest), and one wallet leg so the
    // ledger feed has a row to page through.
    const [contractPayment] = await db
      .insert(payments)
      .values({
        bookingId: contractPaidBookingId,
        amount: '2400.00',
        taxAmount: '0.00',
        purpose: 'booking',
        method: 'upi',
        status: 'captured',
        idempotencyKey: 'contract:payment:1',
        provider: 'contract',
        capturedAt: new Date(),
        refundedAmount: '500.00',
      })
      .returning({ id: payments.id });

    await db.insert(refunds).values({
      bookingId: contractPaidBookingId,
      paymentId: contractPayment!.id,
      amount: '500.00',
      reason: 'contract coverage partial refund',
      status: 'processed',
      idempotencyKey: 'contract:refund:1',
      initiatedBy: 'system',
      kind: 'partial',
      liability: 'driver',
      gatewayRef: 'rf_test_contract',
      processedAt: new Date(),
    });

    await seedWalletWithLedger(db, { ownerId: pendingDriverId, ownerType: 'driver' }, [
      { type: 'adjustment', amount: '250.00', refId: contractPaidBookingId },
    ]);

    // W14 — one open SOS alert so the queue row above is non-empty. Subject is
    // the contract customer, so the joined name/mobile resolve rather than
    // coming back null on a route whose whole job is showing who is in trouble.
    await db.insert(sosAlerts).values({
      subjectType: 'user',
      subjectId: contractCustomer,
      lat: 12.9716,
      lng: 77.5946,
      accuracyM: 9,
      source: 'app',
      status: 'triggered',
    });

    // W15 — one ticket (with its opening message) and two content pages. The
    // ticket belongs to the contract customer so the requester-scoped row
    // above is a real list, and the pages make the public content read
    // non-empty (an empty array matches almost any schema).
    const [contractTicket] = await db
      .insert(supportTickets)
      .values({
        reference: 'TKT-CONTRACT1',
        requesterType: 'user',
        requesterId: contractCustomer,
        category: 'booking',
        subject: 'Contract coverage ticket',
        status: 'open',
        priority: 'normal',
      })
      .returning({ id: supportTickets.id });
    await db.insert(supportTicketMessages).values({
      ticketId: contractTicket!.id,
      authorType: 'requester',
      authorId: contractCustomer,
      body: 'The contract table needs a real ticket to read.',
      visibility: 'public',
    });
    await db.insert(contentPages).values([
      {
        slug: 'contract-faq',
        kind: 'faq',
        title: 'Contract question',
        bodyMd: 'Contract answer.',
        sortOrder: 1,
        isPublished: true,
      },
      {
        slug: 'contract-terms',
        kind: 'legal',
        title: 'Contract Terms',
        bodyMd: 'Contract legal copy.',
        sortOrder: 1,
        isPublished: true,
      },
    ]);

    // W16 — a coupon and two live customer banners. Two banners rather than
    // one so the carousel row above proves it is an ORDERED array (a one-row
    // response would match the schema with the ordering code deleted); the
    // image keys are minted-shape strings — the admin read presigns them, and
    // no file needs to exist for a signature.
    await db.insert(coupons).values({
      code: 'CONTRACT20',
      kind: 'percent',
      value: '20.00',
      minOrder: '0',
    });
    await db.insert(banners).values([
      {
        title: 'Contract banner one',
        imageKey: `banner-images/00000000-0000-4000-8000-000000000001/banner-11111111-1111-4111-8111-111111111111.jpg`,
        audience: 'customer',
        sortOrder: 1,
      },
      {
        title: 'Contract banner two',
        imageKey: `banner-images/00000000-0000-4000-8000-000000000002/banner-22222222-2222-4222-8222-222222222222.png`,
        audience: 'customer',
        sortOrder: 2,
      },
    ]);

    // W18 — one delivery so the log row above is non-empty. Destination is the
    // MASKED form because that is the only form the table ever stores.
    const [contractEvent] = await db
      .insert(notificationEvents)
      .values({ event: 'contract.notification', payload: {} })
      .returning({ id: notificationEvents.id });
    await db.insert(notificationDeliveries).values({
      eventId: contractEvent!.id,
      recipientKey: `user:${contractCustomer}`,
      channel: 'email',
      destination: 'c***@example.com',
      status: 'sent',
      vendor: 'log',
      attempts: 1,
      sentAt: new Date(),
    });

    // W19 — one open deletion request (the queue row above would be an empty
    // array otherwise) and the G16 policy rows. Migration 0033 seeds the
    // policies for a fresh database, but this spec truncates every table
    // first, so the defaults are re-inserted exactly as `db:seed` does.
    await db.insert(deletionRequests).values({
      subjectType: 'user',
      subjectId: contractCustomer,
      reason: 'contract coverage request',
    });
    await db
      .insert(retentionPolicies)
      .values(
        RETENTION_POLICY_DEFAULTS.map((policy) => ({
          policyKey: policy.policyKey,
          retentionDays: policy.retentionDays,
          description: policy.description,
        })),
      )
      .onConflictDoNothing({ target: retentionPolicies.policyKey });
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  for (const route of ROUTES) {
    it(`GET ${route.path} matches its contract`, async () => {
      const token =
        route.realm === 'customer' ? customerAuth : route.realm === 'admin' ? adminAuth : auth;
      const res = await request(app.getHttpServer())
        .get(route.path)
        .set('Authorization', token)
        .expect(200);

      expectMatchesContract(route.schema, res.body);
    });
  }

  /**
   * The guard that stops the table above from rotting.
   *
   * A new fleet read endpoint added without a contract assertion is exactly the
   * kind of omission nobody notices, because everything still passes. This walks
   * the routes Express actually registered and demands each one be accounted
   * for — either covered, or explicitly excluded with a reason.
   */
  it('covers every registered fleet, customer and admin GET route', () => {
    // Phase 14 widened this beyond `/v1/fleet/`. The guard was fleet-only
    // because the fleet console was the only client; `GET /v1/services` is the
    // first customer read with a published contract, and leaving the walk
    // fleet-scoped would have meant every future TowGo route was uncovered by
    // default — a ratchet that stops ratcheting.
    // A1 widens it again to `/v1/admin` for the same reason.
    const registered = registeredGetPaths(app).filter(
      (path) => isCovered(path) && !EXCLUDED.has(path),
    );

    // Without this the guard is worthless: if Express ever moves its router
    // internals, `registeredGetPaths` returns [] and every future uncovered
    // route passes silently. Failing loudly on an empty walk is the difference
    // between a guard and a comment.
    expect(registered.length).toBeGreaterThan(5);

    const covered = new Set(ROUTES.map((route) => route.path.split('?')[0]));
    const uncovered = registered.filter((path) => !covered.has(path));

    expect(uncovered).toEqual([]);
  });
});

/** Realms whose GET routes this table is responsible for. */
const COVERED_PREFIXES = [
  '/v1/fleet',
  '/v1/services',
  '/v1/me',
  '/v1/bookings',
  '/v1/admin',
  // W15: the requester's own reads and the public FAQ/legal pages.
  '/v1/support',
  '/v1/content',
  // W16: the public carousel read.
  '/v1/banners',
];

/**
 * Segment-aware, NOT `startsWith`. A bare prefix test matched `/v1/metrics`
 * against `/v1/me` and dragged the Prometheus scrape endpoint — which serves
 * text, not a DTO — into a table of JSON contracts.
 */
function isCovered(path: string): boolean {
  return COVERED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Routes with no response schema, named individually so the guard cannot be
 * satisfied by a wildcard nobody revisits.
 */
const EXCLUDED = new Set([
  // CSV downloads — a byte stream, not a DTO. Their shape is asserted in the
  // module specs that own them (no customer column in the statement, formula
  // injection neutralised).
  '/v1/fleet/jobs/export.csv',
  '/v1/fleet/earnings/statement.csv',
  '/v1/fleet/reports/export.csv',
  '/v1/fleet/trucks/bulk/template.csv',
  '/v1/fleet/trucks/bulk/:importId/errors.csv',
  // Bulk import status: covered by imports.e2e.spec.ts against
  // `truckImportSchema`, which needs an import to exist first.
  '/v1/fleet/trucks/bulk',
  '/v1/fleet/trucks/bulk/:importId',
  // Session identity, asserted in the auth specs.
  '/v1/fleet/auth/me',
  // ── A REAL GAP, NAMED RATHER THAN HIDDEN ────────────────────────────────
  // Phase 14 widened this guard's walk past `/v1/fleet/`, and it immediately
  // surfaced these nine: every one has a behaviour spec in `modules/me`, and
  // not one of them asserts its response against a published schema. They are
  // excluded so the guard can protect everything else, and listed individually
  // so the debt is countable. Backfilling them is Phase 12's contract coverage,
  // not Phase 14's — but it is now impossible to add a TENTH uncovered
  // customer route without this list growing in the diff.
  '/v1/me',
  '/v1/me/vehicles',
  '/v1/me/addresses',
  '/v1/me/emergency-contacts',
  '/v1/me/export',
  '/v1/me/notifications',
  '/v1/me/notifications/unread-count',
  '/v1/me/notification-prefs',
  '/v1/me/consent',
  // Parameterised customer reads. This table's paths are static, so a route
  // needing a real booking id cannot appear in it; both are contract-asserted
  // with `expectMatchesContract` in `bookings-read.e2e.spec.ts` and
  // `booking-otp.e2e.spec.ts`.
  '/v1/bookings/:id',
  '/v1/bookings/:id/otp',
  // Phase 18's three, same reason and the same discipline: each is asserted
  // with `expectMatchesContract` in `share-trip.e2e.spec.ts` against
  // `bookingTrackingSchema`, `cancellationQuoteSchema` and `callContactSchema`
  // respectively. Excluded here only because this table's paths are static and
  // these need a real booking.
  '/v1/bookings/:id/tracking',
  '/v1/bookings/:id/cancellation-quote',
  '/v1/bookings/:id/contact',
  // Phase 19's, same reason and the same discipline: asserted with
  // `expectMatchesContract` against `ratingStateSchema` in
  // `ratings.e2e.spec.ts`. Needs a real, finished booking.
  '/v1/bookings/:id/rating',
  // §9.1.10's invoice link, asserted with `expectMatchesContract` against
  // `invoiceLinkSchema` in `invoice.e2e.spec.ts` — it needs a PAID booking,
  // which this table's static paths cannot produce.
  '/v1/bookings/:id/invoice',
  // Development-only OTP echo (`AUTH_DEV_OTP_ECHO`, and production refuses to
  // boot with it set). It has no contract schema ON PURPOSE: publishing one in
  // `@towing/api-contracts` would advertise to every client a route that must
  // never exist in production. Its own guard rails are in dev-otp.e2e.spec.ts.
  '/v1/fleet/auth/dev/otp',
  // A1 — the admin dev-OTP echo. Same rationale as the fleet one above: a
  // debug payload, not a DTO, 404 unless `AUTH_DEV_OTP_ECHO`.
  '/v1/admin/auth/dev/otp',
  // W2 — parameterised admin detail. Same discipline as the customer `:id`
  // rows above: asserted with `expectMatchesContract` against
  // `adminAdminDetailSchema` in `admin-users.e2e.spec.ts`, which owns a real id.
  '/v1/admin/admins/:id',
  // W1 §3.5 — audit detail, asserted with `expectMatchesContract` against
  // `adminAuditDetailSchema` in `admin-audit.e2e.spec.ts`, which owns a real id.
  '/v1/admin/audit/:id',
  // W5 — the inspector detail. Asserted with `expectMatchesContract` against
  // `adminDispatchInspectorResponseSchema` in `admin-ops-dispatch.e2e.spec.ts`,
  // which owns a real dispatched booking and drives the wave engine directly.
  '/v1/admin/ops/dispatch/:bookingId',
  // W6 — parameterised directory detail, asserted with `expectMatchesContract`
  // against `adminDirectoryUserDetailSchema` and the bookings envelope in
  // `admin-directory-users.e2e.spec.ts`, which owns a real user.
  '/v1/admin/users/:id',
  '/v1/admin/users/:id/bookings',
  // W6 — the drivers directory's parameterised routes, asserted with
  // `expectMatchesContract` against `adminDriverDirectoryDetailSchema` and
  // `adminDriverBookingsResponseSchema` in `admin-drivers-directory.e2e.spec.ts`,
  // which owns a real driver. `GET /admin/drivers/pending` is walked above
  // because the KYC module registers first; `:id` must never shadow it.
  '/v1/admin/drivers/:id',
  '/v1/admin/drivers/:id/bookings',
  // W7 - the document history. Parameterised by driver id, so it belongs here
  // with its contract asserted (`adminDriverDocumentVersionsResponseSchema`)
  // in `admin-kyc-w7.e2e.spec.ts`, which uploads real versions first.
  '/v1/admin/drivers/:id/document-versions',
  // W8 — the bookings detail and its audited invoice link, parameterised by
  // booking id. Asserted with `expectMatchesContract` against
  // `adminBookingDetailSchema` / `adminBookingInvoiceSchema` in
  // `admin-bookings.e2e.spec.ts`, which owns a real booking.
  '/v1/admin/bookings/:id',
  '/v1/admin/bookings/:id/invoice',
  // W8 — the bookings CSV, a byte stream like the fleet exports above; its
  // shape (header order, no formula injection) is asserted in
  // `admin-bookings.e2e.spec.ts`.
  '/v1/admin/bookings/export.csv',
  // W8 — the dispute detail, parameterised; asserted with
  // `expectMatchesContract` against `adminDisputeDetailSchema` in
  // `admin-disputes.e2e.spec.ts`, which opens a real dispute.
  '/v1/admin/disputes/:id',
  // W14 — the SOS detail (alert + contact snapshot + full timeline),
  // parameterised; asserted with `expectMatchesContract` against
  // `adminSosDetailSchema` in `sos.e2e.spec.ts`, which raises a real alert.
  '/v1/admin/sos/:id',
  // W15 — the requester's ticket detail and the console's, parameterised;
  // asserted with `expectMatchesContract` against `supportTicketDetailSchema`
  // and `adminSupportTicketDetailSchema` in `support.e2e.spec.ts`.
  '/v1/support/tickets/:id',
  '/v1/admin/support/tickets/:id',
  // W15 — the content editor's per-slug read, parameterised; asserted against
  // `adminContentPageSchema` in `content.e2e.spec.ts`.
  '/v1/admin/content/:slug',
  // W16 — the coupon redemption ledger, parameterised by coupon id; asserted
  // with `expectMatchesContract` against `adminCouponRedemptionsResponseSchema`
  // in `promotions-admin.e2e.spec.ts`, which claims a real redemption first.
  '/v1/admin/coupons/:id/redemptions',
  // W19 — the privacy queue's parameterised detail, plus the operator-served
  // access export. Both are contract-asserted with `expectMatchesContract`
  // (`adminDeletionRequestSchema`, `adminSubjectExportResponseSchema`) in
  // `privacy-erasure.e2e.spec.ts`, which owns a real request and a real user;
  // the four decision/execute POSTs are asserted there too. They cannot sit in
  // this table because every one of them needs a row this static walk cannot
  // create.
  '/v1/admin/privacy/deletion-requests/:id',
  '/v1/admin/users/:id/export',
  // W15 — the public content read is parameterised by KIND, and `kind` has two
  // legal values; the static `/v1/content/faq` row above walks that envelope
  // (the `/v1/content/legal` twin is the same handler and the same schema), so
  // only the placeholder form needs excluding.
  '/v1/content/:kind',
  // W9 — the reconciliation download is a byte stream like the fleet exports;
  // its header order and signed refund rows are asserted in
  // \`admin-finance-console.e2e.spec.ts\`.
  '/v1/admin/finance/reconciliation.csv',
  // W17 — the analytics export is a byte stream; its header, its forbidden-PII
  // columns and its rows are asserted in `analytics.e2e.spec.ts`.
  '/v1/admin/analytics/export.csv',
  // W13 — parameterised zone reads. Asserted with `expectMatchesContract`
  // against `adminZoneSchema` and `adminZoneVersionSchema` in
  // `admin-zones.e2e.spec.ts`, which creates a real zone and edits it twice so
  // the version drawer has more than one row to read.
  '/v1/admin/zones/:id',
  '/v1/admin/zones/:id/versions',
  // W6 — the fleets directory's parameterised routes: detail asserted against
  // `adminFleetDetailSchema`, the sub-reads against the FLEET console's own
  // schemas, all in `admin-fleets-directory.e2e.spec.ts`.
  '/v1/admin/fleets/:id',
  '/v1/admin/fleets/:id/trucks',
  '/v1/admin/fleets/:id/drivers',
  '/v1/admin/fleets/:id/earnings',
  // W6/G8 — the app-view tree. Every route here needs a LIVE impersonation
  // session, which a static walk cannot mint — `admin-impersonation.e2e.spec.ts`
  // owns one, asserts all five against the customer schemas each section
  // reuses, and pins the whole tree to GET-only off the router itself.
  '/v1/admin/users/:id/app-view/trips',
  '/v1/admin/users/:id/app-view/wallet',
  '/v1/admin/users/:id/app-view/notifications',
  '/v1/admin/users/:id/app-view/vehicles',
  '/v1/admin/users/:id/app-view/addresses',
]);

/** Express 5 keeps the registered layers on `router.stack`. */
function registeredGetPaths(app: INestApplication): string[] {
  const instance = app.getHttpAdapter().getInstance() as {
    router?: { stack?: RouterLayer[] };
  };

  const stack = instance.router?.stack ?? [];
  const paths = new Set<string>();

  for (const layer of stack) {
    if (!layer.route || layer.route.methods?.get !== true) continue;
    for (const path of asArray(layer.route.path)) paths.add(path);
  }

  return [...paths];
}

interface RouterLayer {
  route?: { path?: string | string[]; methods?: Record<string, boolean> };
}

function asArray(value: string | string[] | undefined): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value : [];
}
