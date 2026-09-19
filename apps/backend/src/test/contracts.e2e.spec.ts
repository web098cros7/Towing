import type { INestApplication } from '@nestjs/common';
import {
  adminAdminsListResponseSchema,
  adminAuditListResponseSchema,
  adminCommissionConfigSchema,
  adminDispatchConfigSchema,
  adminDispatchInspectorListResponseSchema,
  adminFinanceConfigSchema,
  adminIdentitySchema,
  adminNotesResponseSchema,
  adminOpsActivityResponseSchema,
  adminOpsBadgesResponseSchema,
  adminOpsDashboardResponseSchema,
  adminOpsLiveResponseSchema,
  adminPendingDriversResponseSchema,
  adminPayoutsListResponseSchema,
  adminPricingConfigSchema,
  adminSessionsResponseSchema,
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
  bookingStatusHistory,
  commissionConfigHistory,
  driverDocuments,
  drivers,
  payouts,
  serviceZones,
} from '../db/schema';
import { seedBooking, seedTruck, seedWalletWithLedger } from '../test/fixtures';
import { closeTestRedis, testRedis } from '../test/redis';
import { expectMatchesContract } from './contracts';
import { seedPricingFixtures } from '../modules/pricing/pricing.e2e.spec';
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
  const ROUTES: Array<{ path: string; schema: z.ZodType; realm?: 'fleet' | 'customer' | 'admin' }> = [
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
    { path: '/v1/admin/drivers/pending', schema: adminPendingDriversResponseSchema, realm: 'admin' },
    { path: '/v1/admin/finance/payouts', schema: adminPayoutsListResponseSchema, realm: 'admin' },
    { path: '/v1/admin/finance/config', schema: adminFinanceConfigSchema, realm: 'admin' },
    { path: '/v1/admin/pricing', schema: adminPricingConfigSchema, realm: 'admin' },
    { path: '/v1/admin/commission', schema: adminCommissionConfigSchema, realm: 'admin' },
    {
      path: '/v1/admin/commission/history',
      schema: z.array(commissionHistoryEntrySchema),
      realm: 'admin',
    },
    { path: '/v1/admin/dispatch-config', schema: adminDispatchConfigSchema, realm: 'admin' },
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
    await seedBooking(db, { userId: fleet.ownerId, fleetId, driverId, status: 'paid' });
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
    const pendingDriverId = await seedDriver(db, { kycStatus: 'pending', name: 'Contract Pending' });
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
    // an empty array without it, which matches almost any schema).
    await seedBooking(db, { userId: contractCustomer, status: 'searching' });
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  for (const route of ROUTES) {
    it(`GET ${route.path} matches its contract`, async () => {
      const token = route.realm === 'customer' ? customerAuth : route.realm === 'admin' ? adminAuth : auth;
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
const COVERED_PREFIXES = ['/v1/fleet', '/v1/services', '/v1/me', '/v1/bookings', '/v1/admin'];

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
