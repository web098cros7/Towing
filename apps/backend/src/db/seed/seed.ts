import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { NOTIFICATION_PREF_DEFAULTS } from '@towing/api-contracts';
import { loadEnv } from '../../config/env';
import { runComplianceSweep } from '../../modules/compliance/compliance-sweep';
import { rebuildEarnings } from '../../modules/money/earnings-projector';
import { hashPassword } from '../../modules/auth/password';
import { digest } from '../../modules/auth/otp.util';
import { ledgerInvariants } from '../ledger/invariants';
import type { LatLng } from '../geography';
import type * as schema from '../schema';
import {
  adminUsers,
  bookingStatusHistory,
  bookings,
  chargeConfig,
  commissionConfig,
  commissionConfigHistory,
  complianceDocuments,
  dispatchConfig,
  driverDocuments,
  drivers,
  fleetDriverShares,
  fleetOwnerCredentials,
  fleetTrucks,
  fleets,
  payments,
  payoutAccounts,
  payouts,
  pricingRules,
  serviceZones,
  services,
  users,
  walletTransactions,
  wallets,
} from '../schema';
import {
  ADMIN_FIXTURES,
  CUSTOMER_NAMES,
  FLEETS,
  FLEET_DRIVERS,
  INDEPENDENT_DRIVER,
  SERVICE_CATALOG,
  SERVICE_MIX,
  STANDALONE_ZONES,
  TRUCKS,
  SEED_PASSWORD,
  centroid,
  type AdminFixture,
  type DriverFixture,
  type FleetFixture,
} from './fixtures';
import type { SurgeBand } from '@towing/api-contracts';
import { DEFAULT_CHARGE_CONFIG, DEFAULT_PRICING_RULES } from '../../modules/pricing/pricing.math';
import {
  BAND_PCT,
  commissionPaise,
  computeFare,
  createRng,
  pick,
  resolveBand,
  splitPool,
  toRupees,
  weighted,
  type Band,
  type ServiceType,
  type VehicleClass,
} from './pricing';

/**
 * Deterministic demo dataset for the TowFleet console.
 *
 * Everything money-bearing follows the production rules: §7 fare formula,
 * §3.3 band lock at confirm, §14.3 pool split, signed append-only ledger with
 * unique idempotency keys, `wallets.balance` == SUM(ledger). The invariant
 * queries in `verifySeedInvariants` fail the run if any of that drifts — the
 * seed is the first consumer of the same discipline the Phase 7 ledger service
 * must keep.
 *
 * Exported as functions (rather than only a CLI) so the vitest suite runs the
 * same seed against the throwaway test stack.
 */

export type SeedDatabase = PostgresJsDatabase<typeof schema>;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const HISTORY_DAYS = 90;
const RNG_SEED = 20_260_803;

const BOOKINGS_PER_FLEET: Record<FleetFixture['key'], number> = { lakshmi: 260, chr: 210 };
const INDEPENDENT_BOOKINGS = 30;
const CHUNK = 50;

/**
 * Chunk size once `scale > 1`. 50 keeps the statements small and readable at
 * demo volume; at ×10 it would mean roughly 600 round trips, and 200 rows of
 * ~20 columns is still far under postgres.js's 65,535 bind-parameter ceiling.
 * Conditional so the scale-1 path issues byte-identical statements.
 */
const LOAD_CHUNK = 200;

/** Tables owned by the app (CASCADE resolves FK order). */
const APP_TABLES = [
  'alerts',
  // Before `admin_users`: an audit row references the admin who wrote it, and
  // although CASCADE resolves the order anyway, the list reads as the graph.
  'admin_actions',
  // Notification spine (Phase 13). Deliveries and inbox rows both cascade from
  // notification_events, but listing them keeps the reset explicit.
  'notification_deliveries',
  'notifications',
  'notification_events',
  'devices',
  // Phase 12's DPDP tables were missing from this list — a reset left consent
  // and deletion rows behind, so a re-seeded database still believed the old
  // users had consented.
  'consent_records',
  'deletion_requests',
  'truck_imports',
  'webhook_events',
  'earnings_daily',
  'wallet_transactions',
  'payments',
  'refunds',
  'payouts',
  'payout_accounts',
  'wallets',
  'booking_location_path',
  'dispatch_attempts',
  'booking_status_history',
  'bookings',
  'fleet_driver_shares',
  'driver_documents',
  'drivers',
  // After both tables that reference it via `approved_by` / `verified_by`.
  'admin_users',
  'social_identities',
  'compliance_documents',
  'fleet_trucks',
  'login_challenges',
  'refresh_tokens',
  'otp_verifications',
  'fleet_owner_credentials',
  'fleets',
  'service_zones',
  // Phase 14 config. `commission_config_history` before `commission_config`
  // and `admin_users` for the same reason `admin_actions` is listed early:
  // CASCADE would resolve it, but the list reads as the graph.
  'commission_config_history',
  'commission_config',
  'charge_config',
  'dispatch_config',
  'pricing_rules',
  'services',
  'saved_vehicles',
  'addresses',
  'emergency_contacts',
  'users',
] as const;

type HistoricalStatus = 'paid' | 'completed' | 'cancelled' | 'no_drivers_found' | 'disputed';

const HISTORICAL_MIX: ReadonlyArray<readonly [HistoricalStatus, number]> = [
  ['paid', 78],
  ['completed', 7],
  ['cancelled', 9],
  ['no_drivers_found', 3],
  ['disputed', 3],
];

export interface SeedSummary {
  fleets: number;
  trucks: number;
  complianceDocs: number;
  drivers: number;
  customers: number;
  bookings: number;
  historyRows: number;
  payments: number;
  ledgerRows: number;
  payouts: number;
  /** Active Route linked accounts — one per fleet, the payout destination. */
  payoutAccounts: number;
  wallets: number;
  /** Opened by the compliance sweep the seed runs at the end. */
  alerts: number;
  /** Trucks the sweep moved to `non_compliant` on expired papers. */
  trucksBlocked: number;
  /** `earnings_daily` cells built by the real projector at the end of the seed. */
  earningsCells: number;
  /** One admin per RBAC sub-role, so the §3.1 approval gate is operable locally. */
  adminUsers: number;
  /** `driver_documents` rows across the non-`approved` KYC fixtures (Phase 11). */
  driverDocuments: number;
}

export interface SeedInvariants {
  walletDrift: number;
  bookingDrift: number;
  ledgerDrift: number;
  reversalDrift: number;
  couponDrift: number;
}

interface SeededDriver {
  id: string;
  name: string;
  fleetKey: FleetFixture['key'] | null;
  vehicleClass: VehicleClass;
  longDistance: boolean;
  driverSharePct: number;
}

function jitter(rng: () => number, point: LatLng, spreadDeg = 0.012): LatLng {
  return {
    lat: point.lat + (rng() * 2 - 1) * spreadDeg,
    lng: point.lng + (rng() * 2 - 1) * spreadDeg,
  };
}

/**
 * A deterministic 6-digit booking OTP, HASHED before it is stored.
 *
 * The seed used to write the plaintext code into `bookings.booking_otp`. That
 * column is `booking_otp_hash` since migration 0012 and takes the same SHA-256
 * digest `login_challenges.code_hash` has always used — the seed produces
 * realistic rows, not a plaintext credential store.
 *
 * `rng`, not `generateOtp()`: seeded data must stay reproducible, and the
 * digest is what production reads either way.
 */
function otpCodeHash(rng: () => number): string {
  const code = Math.floor(rng() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return digest(code);
}

/**
 * A 1x1 transparent PNG — just enough bytes for `GET /v1/files/:key` (Phase
 * 11) to have something real to stream. The admin queue's whole point is to
 * render a document; a fixture with no bytes behind it would only prove the
 * happy path where nobody actually opens the drawer.
 */
const PLACEHOLDER_DOCUMENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function writePlaceholderDocument(uploadsDir: string, key: string): Promise<void> {
  const path = join(uploadsDir, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, PLACEHOLDER_DOCUMENT_PNG);
}

async function insertChunked<T>(
  run: (chunk: T[]) => Promise<void>,
  rows: T[],
  size = CHUNK,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await run(rows.slice(i, i + size));
  }
}

/**
 * Seeds the database. Returns `null` (without touching anything) when data
 * already exists and `reset` was not requested; otherwise returns the summary.
 */
export async function runSeed(
  db: SeedDatabase,
  options: { reset?: boolean; now?: Date; scale?: number } = {},
): Promise<SeedSummary | null> {
  const reset = options.reset ?? false;
  const now = options.now ?? new Date();
  const rng = createRng(RNG_SEED);

  /**
   * Load-test volume multiplier (`pnpm db:seed:load`). 1 is the demo dataset
   * and is the ONLY value anything asserts against: `seed.spec.ts` pins seven
   * exact counts and the three §14 invariants. Every use below multiplies by
   * `scale`, so at 1 the arithmetic is the identity and this whole feature is
   * provably inert — the scale-1 path is byte-identical by construction rather
   * than by inspection.
   *
   * WHAT SCALES IS VOLUME, NOT THE CAST — 2 fleets, 20 trucks and 12 drivers
   * stay put while bookings, payments, ledger rows and projection cells
   * multiply. That is deliberate. Query cost on every console read path is
   * driven by the size of `bookings`, `wallet_transactions` and
   * `earnings_daily`, not by how many fleets those rows are spread across; and
   * a single tenant holding 2,600 bookings is a strictly harder case for the
   * per-tenant queries the console actually runs than twenty tenants holding
   * 260 each. Cloning the cast would also mean cloning it into the middle of a
   * single sequential RNG stream, which would shift every draw after it and
   * silently change the demo data.
   */
  const scale = Math.max(1, Math.trunc(options.scale ?? 1));
  const chunkSize = scale === 1 ? CHUNK : LOAD_CHUNK;

  const [{ count: fleetCount }] = (await db.execute(
    sql`select count(*)::int as count from fleets`,
  )) as unknown as [{ count: number }];

  if (fleetCount > 0 && !reset) return null;

  if (reset) {
    await db.execute(sql.raw(`truncate table ${APP_TABLES.join(', ')} cascade`));
  }

  // Password hashing outside the transaction — scrypt is deliberately slow.
  const ownerCredentials = await Promise.all(
    FLEETS.map(async (fleet) => ({
      fleet,
      passwordHash: await hashPassword(SEED_PASSWORD),
    })),
  );

  const adminCredentials = await Promise.all(
    ADMIN_FIXTURES.map(async (admin) => ({ admin, passwordHash: await hashPassword(SEED_PASSWORD) })),
  );

  const summary: SeedSummary = {
    fleets: 0,
    trucks: 0,
    complianceDocs: 0,
    drivers: 0,
    customers: 0,
    bookings: 0,
    historyRows: 0,
    payments: 0,
    ledgerRows: 0,
    payouts: 0,
    payoutAccounts: 0,
    wallets: 0,
    alerts: 0,
    trucksBlocked: 0,
    earningsCells: 0,
    adminUsers: 0,
    driverDocuments: 0,
  };

  const env = loadEnv();
  const adminIdBySubRole = new Map<AdminFixture['subRole'], string>();

  await db.transaction(async (tx) => {
    // ── Admin operators (§9.4) ───────────────────────────────────────────────
    // One per RBAC sub-role, so the §3.1 approval gate is operable the moment a
    // developer runs `pnpm db:seed` — without an admin nobody can move a driver
    // to `approved`, and every phase downstream of that gate is untestable.
    // `support` exists so the RBAC negative ("cannot approve KYC") is real.
    for (const { admin, passwordHash } of adminCredentials) {
      const [row] = await tx
        .insert(adminUsers)
        .values({
          email: admin.email,
          mobile: admin.mobile,
          name: admin.name,
          passwordHash,
          subRole: admin.subRole,
        })
        .returning({ id: adminUsers.id });
      adminIdBySubRole.set(admin.subRole, row!.id);
      summary.adminUsers += 1;
    }

    // ── Owners, credentials, fleets, zones ──────────────────────────────────
    const fleetByKey = new Map<
      FleetFixture['key'],
      { id: string; zoneId: string; fixture: FleetFixture }
    >();

    for (const { fleet, passwordHash } of ownerCredentials) {
      const [owner] = await tx
        .insert(users)
        .values({ mobile: fleet.owner.mobile, name: fleet.owner.name, email: fleet.owner.email })
        .returning({ id: users.id });

      await tx.insert(fleetOwnerCredentials).values({
        userId: owner!.id,
        email: fleet.owner.email,
        passwordHash,
      });

      const [fleetRow] = await tx
        .insert(fleets)
        .values({
          ownerId: owner!.id,
          businessName: fleet.businessName,
          gstin: fleet.gstin,
          address: fleet.address,
          status: 'active',
          // Seeded fleets are established businesses, not first-run accounts:
          // they must land past the §9.3.1 gate, or `POST /fleet/payouts` —
          // the headline feature of this phase — 403s on its own demo data.
          notificationPrefs: NOTIFICATION_PREF_DEFAULTS,
          onboardingStep: 'done',
          profileCompletedAt: now,
        })
        .returning({ id: fleets.id });

      // The payout destination. Without an `active` row the payout endpoint
      // 409s `payout_account_not_linked` and the console's Request-payout
      // button is permanently disabled on a fresh seed. `acc_seed_*` marks the
      // provenance so these are never mistaken for real Route accounts.
      await tx.insert(payoutAccounts).values({
        ownerId: fleetRow!.id,
        ownerType: 'fleet',
        status: 'active',
        routeAccountId: `acc_seed_${fleet.key}`,
        routeFundAccountId: `fa_seed_${fleet.key}`,
        beneficiaryName: fleet.businessName,
        accountNumberLast4: '4021',
        accountNumberFingerprint: createHash('sha256')
          .update(`seed:${fleet.key}|HDFC0000123`)
          .digest('hex'),
        ifsc: 'HDFC0000123',
        bankName: 'HDFC Bank',
        linkedAt: now,
      });
      summary.payoutAccounts += 1;

      // Phase 14: `surgeBand`, `isHighway` and `dispatchConfig` all come from
      // the fixture now. Before this, every zone was inserted with
      // `surgeBand: 'standard'` hard-coded, `is_highway` left false and
      // `dispatch_config` left NULL — so the §7.4 highway and surge paths and
      // the whole §6.7 override mechanism had no seeded row to exercise them.
      const [zone] = await tx
        .insert(serviceZones)
        .values({
          name: fleet.zone.name,
          area: fleet.zone.wkt,
          surgeBand: fleet.zone.surgeBand ?? 'standard',
          isHighway: fleet.zone.isHighway ?? false,
          dispatchConfig: fleet.zone.dispatchConfig ?? null,
        })
        .returning({ id: serviceZones.id });

      fleetByKey.set(fleet.key, { id: fleetRow!.id, zoneId: zone!.id, fixture: fleet });
      summary.fleets += 1;
    }

    // ── Phase 14: platform configuration ────────────────────────────────────
    //
    // Everything §6.7 and §16.5 call tunable, seeded with its launch value.
    // Before this the §7 matrix was a `const` in this directory and the §6.2
    // scorer weights did not exist anywhere.

    // Standalone zones — a highway corridor belongs to no fleet, so it could not
    // exist while zones were only created inside the per-fleet loop above. It is
    // what makes the §7.4 highway surcharge reachable, and it deliberately
    // overlaps Bengaluru Metro so `ZoneResolverService`'s precedence rule has
    // something real to resolve.
    for (const fixture of STANDALONE_ZONES) {
      await tx.insert(serviceZones).values({
        name: fixture.name,
        area: fixture.wkt,
        surgeBand: fixture.surgeBand ?? 'standard',
        isHighway: fixture.isHighway ?? false,
        dispatchConfig: fixture.dispatchConfig ?? null,
      });
    }

    // Appendix B's nine entries over six `service_type` values.
    await tx.insert(services).values(
      SERVICE_CATALOG.map((service, index) => ({
        slug: service.slug,
        serviceType: service.serviceType,
        defaultVehicleClass: service.defaultVehicleClass,
        name: service.name,
        description: service.description,
        requiresDrop: service.requiresDrop,
        displayOrder: index,
      })),
    );

    // §7.1/§7.2/§7.3 as rows. `DEFAULT_PRICING_RULES` is the same constant the
    // engine falls back to, so a seeded database and an unseeded one price
    // identically — the table is what makes the numbers EDITABLE, not what makes
    // them correct.
    const ruleRows: Array<typeof pricingRules.$inferInsert> = [];
    for (const vehicleClass of ['wheel_lift', 'flatbed'] as const) {
      for (const slab of DEFAULT_PRICING_RULES.slabs[vehicleClass]) {
        ruleRows.push({
          ruleKind: 'slab',
          vehicleClass,
          maxKm: slab.maxKm.toFixed(2),
          price: toRupees(slab.pricePaise),
        });
      }
    }
    for (const band of DEFAULT_PRICING_RULES.longDistance) {
      ruleRows.push({
        ruleKind: 'long_distance',
        // §7.3 is titled "Long-Distance Flatbed" and §3.3 Band C is "Flatbed
        // hauling" — the class is not a variable here.
        vehicleClass: 'flatbed',
        maxKm: band.maxKm.toFixed(2),
        price: toRupees(band.pricePaise),
        priceMax: toRupees(band.priceMaxPaise ?? band.pricePaise),
      });
    }
    for (const [serviceType, farePaise] of Object.entries(DEFAULT_PRICING_RULES.roadside)) {
      ruleRows.push({
        ruleKind: 'roadside',
        serviceType: serviceType as ServiceType,
        price: toRupees(farePaise),
      });
    }
    await tx.insert(pricingRules).values(ruleRows);

    // §7.4 and §6.2 — one row each, column defaults carry the launch values.
    await tx.insert(chargeConfig).values({});
    await tx.insert(dispatchConfig).values({});

    // §3.3 bands, plus a genesis history row per band. The history table is
    // append-only and `old_pct` is nullable precisely for these three: they had
    // nothing before them, and a history that starts at the first EDIT cannot
    // answer "what was it at launch".
    for (const band of ['A', 'B', 'C'] as const) {
      await tx.insert(commissionConfig).values({ band, pct: BAND_PCT[band].toFixed(2) });
      await tx.insert(commissionConfigHistory).values({
        band,
        oldPct: null,
        newPct: BAND_PCT[band].toFixed(2),
        changedBy: null,
        reason: 'Seeded launch default (§3.3)',
      });
    }

    // ── Trucks + compliance documents ───────────────────────────────────────
    const fleetTruckRows = new Map<FleetFixture['key'], Array<{ id: string; usable: boolean }>>();

    for (const [key, trucks] of Object.entries(TRUCKS) as Array<
      [FleetFixture['key'], (typeof TRUCKS)[FleetFixture['key']]]
    >) {
      const fleet = fleetByKey.get(key)!;
      fleetTruckRows.set(key, []);

      for (const truck of trucks) {
        const anyExpired = truck.compliance.some(([, days]) => days !== null && days < 0);
        const status = !truck.active ? 'inactive' : anyExpired ? 'non_compliant' : 'active';
        const area = pick(rng, fleet.fixture.areas);

        const [truckRow] = await tx
          .insert(fleetTrucks)
          .values({
            fleetId: fleet.id,
            type: truck.type,
            plate: truck.plate,
            capacity: truck.capacity,
            status,
            currentLocation:
              status === 'active' ? jitter(rng, { lat: area[1], lng: area[2] }) : null,
          })
          .returning({ id: fleetTrucks.id });
        summary.trucks += 1;
        fleetTruckRows.get(key)!.push({ id: truckRow!.id, usable: truck.active });

        const docs = truck.compliance
          .filter(
            (entry): entry is readonly ['insurance' | 'rc' | 'puc' | 'permit', number] =>
              entry[1] !== null,
          )
          .map(([docType, days]) => ({
            truckId: truckRow!.id,
            docType,
            fileUrl: `seed://compliance/${truck.plate}/${docType}.pdf`,
            issuedAt: new Date(now.getTime() - (330 + Math.floor(rng() * 60)) * DAY_MS),
            expiresAt: new Date(now.getTime() + days * DAY_MS),
            status:
              days < 0
                ? ('expired' as const)
                : days <= 30
                  ? ('expiring_soon' as const)
                  : ('valid' as const),
          }));

        if (docs.length > 0) {
          await tx.insert(complianceDocuments).values(docs);
          summary.complianceDocs += docs.length;
        }
      }
    }

    // ── Drivers + shares ────────────────────────────────────────────────────
    const seededDrivers: SeededDriver[] = [];

    const insertDriver = async (
      fixture: DriverFixture,
      fleetKey: FleetFixture['key'] | null,
    ) => {
      const fleet = fleetKey ? fleetByKey.get(fleetKey)! : null;
      const approved = fixture.kycStatus === 'approved';
      const homeAreas = fleet?.fixture.areas ?? FLEETS[0]!.areas;
      const area = pick(rng, homeAreas);

      // A driver only reaches `pending`/`rejected`/`suspended` by having
      // submitted at some point — `incomplete` never did (still gathering
      // documents). Drives the admin queue's "submitted date" column.
      const everSubmitted =
        fixture.kycStatus === 'pending' ||
        fixture.kycStatus === 'rejected' ||
        fixture.kycStatus === 'suspended';

      const [row] = await tx
        .insert(drivers)
        .values({
          mobile: fixture.mobile,
          name: fixture.name,
          fleetId: fleet?.id ?? null,
          kycStatus: fixture.kycStatus,
          vehicleClass: fixture.vehicleClass,
          longDistanceEnabled: fixture.longDistance,
          rating: fixture.rating,
          totalTrips: fixture.totalTrips,
          acceptanceRate: approved ? (78 + rng() * 18).toFixed(2) : null,
          completionRate: approved ? (90 + rng() * 9).toFixed(2) : null,
          level: fixture.level,
          approvedAt: approved
            ? new Date(now.getTime() - (60 + Math.floor(rng() * 140)) * DAY_MS)
            : null,
          currentLocation: approved ? jitter(rng, { lat: area[1], lng: area[2] }) : null,
          rejectionReason: fixture.rejectionReason ?? null,
          kycSubmittedAt: everSubmitted
            ? new Date(now.getTime() - (2 + Math.floor(rng() * 5)) * DAY_MS)
            : null,
        })
        .returning({ id: drivers.id });
      summary.drivers += 1;

      if (fixture.documents?.length) {
        const reviewerId = adminIdBySubRole.get('operations')!;
        const reviewedAt = new Date(now.getTime() - (1 + Math.floor(rng() * 3)) * DAY_MS);

        for (const doc of fixture.documents) {
          const key = `driver-documents/${row!.id}/${doc.docType}.png`;
          await writePlaceholderDocument(env.UPLOADS_DIR, key);

          const reviewed = doc.status !== 'pending';
          await tx.insert(driverDocuments).values({
            driverId: row!.id,
            docType: doc.docType,
            fileUrl: `local://${key}`,
            status: doc.status,
            rejectionReason: doc.rejectionReason ?? null,
            verifiedBy: reviewed ? reviewerId : null,
            verifiedAt: reviewed ? reviewedAt : null,
          });
          summary.driverDocuments += 1;
        }
      }

      if (approved && fleet) {
        await tx.insert(fleetDriverShares).values({
          fleetId: fleet.id,
          driverId: row!.id,
          driverShare: fixture.driverSharePct.toFixed(2),
          fleetShare: (100 - fixture.driverSharePct).toFixed(2),
        });
      }

      if (approved && fixture.vehicleClass) {
        seededDrivers.push({
          id: row!.id,
          name: fixture.name,
          fleetKey,
          vehicleClass: fixture.vehicleClass,
          longDistance: fixture.longDistance,
          driverSharePct: fixture.driverSharePct,
        });
      }
    };

    for (const [key, roster] of Object.entries(FLEET_DRIVERS) as Array<
      [FleetFixture['key'], (typeof FLEET_DRIVERS)[FleetFixture['key']]]
    >) {
      for (const fixture of roster) await insertDriver(fixture, key);
    }
    await insertDriver(INDEPENDENT_DRIVER, null);

    // ── Truck assignments (§16.4 assign-truck) ──────────────────────────────
    // Deterministic: each fleet's approved drivers take that fleet's usable
    // (non-inactive) trucks in fixture order. Without this, utilization is 0
    // and plates are blank across the console.
    for (const [key] of fleetByKey) {
      const fleetDrivers = seededDrivers.filter((d) => d.fleetKey === key);
      const usableTrucks = fleetTruckRows.get(key)!.filter((t) => t.usable);
      for (let i = 0; i < Math.min(fleetDrivers.length, usableTrucks.length); i += 1) {
        await tx
          .update(drivers)
          .set({ assignedTruckId: usableTrucks[i]!.id })
          .where(sql`${drivers.id} = ${fleetDrivers[i]!.id}`);
      }
    }

    // ── Customers ───────────────────────────────────────────────────────────
    // Scaled alongside the bookings so a ×10 dataset does not funnel ten times
    // the jobs through the same twenty people — which would give `bookings`
    // an unrealistically narrow `user_id` distribution and flatter any index
    // that touches it.
    const customerNames = Array.from(
      { length: CUSTOMER_NAMES.length * scale },
      (_, i) => CUSTOMER_NAMES[i % CUSTOMER_NAMES.length]!,
    );
    const customerRows = await tx
      .insert(users)
      .values(
        customerNames.map((name, i) => ({
          // Stays unique past 100: a longer digit run is still a distinct
          // string, and the scale-1 values are unchanged.
          mobile: `+9198450201${String(i).padStart(2, '0')}`,
          name,
        })),
      )
      .returning({ id: users.id });
    summary.customers = customerRows.length;

    // ── Wallets ─────────────────────────────────────────────────────────────
    const fleetWallets = new Map<FleetFixture['key'], string>();
    for (const [key, fleet] of fleetByKey) {
      const [w] = await tx
        .insert(wallets)
        .values({ ownerId: fleet.id, ownerType: 'fleet' })
        .returning({ id: wallets.id });
      fleetWallets.set(key, w!.id);
    }
    const driverWallets = new Map<string, string>();
    for (const driver of seededDrivers) {
      const [w] = await tx
        .insert(wallets)
        .values({ ownerId: driver.id, ownerType: 'driver' })
        .returning({ id: wallets.id });
      driverWallets.set(driver.id, w!.id);
    }
    summary.wallets = fleetWallets.size + driverWallets.size;

    // ── Bookings ────────────────────────────────────────────────────────────
    type BookingInsert = typeof bookings.$inferInsert;
    type HistoryInsert = typeof bookingStatusHistory.$inferInsert;
    type PaymentInsert = typeof payments.$inferInsert;
    type LedgerInsert = typeof walletTransactions.$inferInsert;

    const bookingRows: BookingInsert[] = [];
    const perBooking: Array<{
      status: string;
      driver: SeededDriver | null;
      fleetKey: FleetFixture['key'] | null;
      createdAt: Date;
      paidAt: Date | null;
      totalPaise: number;
      commissionPaise: number;
      poolPaise: number;
    }> = [];

    const walletSums = new Map<string, number>();
    const credit = (walletId: string, paise: number) =>
      walletSums.set(walletId, (walletSums.get(walletId) ?? 0) + paise);

    const generate = (
      fleetKey: FleetFixture['key'] | null,
      status: string,
      createdAt: Date,
      activeDriver?: SeededDriver,
      /**
       * Forces the customer. Only the live rows pass it, and they must: see
       * `uq_bookings_one_active_per_user` below.
       */
      forcedCustomerId?: string,
    ): void => {
      const fleet = fleetKey ? fleetByKey.get(fleetKey)! : null;
      const areas = fleet?.fixture.areas ?? FLEETS[0]!.areas;
      const pool = seededDrivers.filter((d) => d.fleetKey === fleetKey);
      const withDriver =
        !['no_drivers_found'].includes(status) && !(status === 'cancelled' && rng() < 0.4);
      const driver = activeDriver ?? (withDriver ? pick(rng, pool) : null);

      const service = weighted(rng, SERVICE_MIX) as ServiceType;
      const vehicleClass: VehicleClass =
        driver?.vehicleClass ?? (rng() < 0.6 ? 'wheel_lift' : 'flatbed');

      let distanceKm: number;
      if (['battery', 'flat_tyre', 'fuel', 'breakdown'].includes(service)) {
        distanceKm = 1 + rng() * 9;
      } else if (service === 'accident_recovery') {
        distanceKm = 5 + rng() * 75;
      } else if (driver?.vehicleClass === 'flatbed' && driver.longDistance && rng() < 0.12) {
        distanceKm = 110 + rng() * 340;
      } else {
        distanceKm = rng() < 0.72 ? 2 + rng() * 38 : 41 + rng() * 58;
      }
      distanceKm = Math.round(distanceKm * 10) / 10;

      const hour = createdAt.getHours();
      const band: Band = resolveBand(service, distanceKm);

      // THE RNG PICKS THE SCENARIO; THE ENGINE PRICES IT (Phase 14).
      //
      // Before, this block re-implemented §7's arithmetic inline — including a
      // surge computed on the base alone, which §7.5's third worked example
      // contradicts, and a highway surcharge drawn randomly between ₹500 and
      // ₹1,000 per booking. A rate is configuration, not a property of one
      // booking: it now comes from `charge_config`'s defaults via
      // `computeFare`, and the RNG only decides WHICH bookings were at night,
      // on a highway, surged or kept waiting.
      //
      // This is what makes the Phase 14 golden-file test meaningful: re-pricing
      // a seeded row through the live engine reproduces its stored fare because
      // they are the same function, not because they were checked once.
      const isHighwayPickup = band === 'B' && rng() < 0.6;
      const waitingMinutes = rng() < 0.2 ? 15 + Math.floor(5 + rng() * 25) : 0;
      const surgeBand: SurgeBand =
        rng() < 0.15 ? (rng() < 0.5 ? 'high' : 'peak') : 'standard';
      const requestedDiscountPaise = rng() < 0.1 ? (100 + Math.floor(rng() * 3) * 100) * 100 : 0;

      const fare = computeFare({
        service,
        vehicleClass,
        distanceKm,
        hourOfDay: hour,
        isHighwayPickup,
        surgeBand,
        waitingMinutes,
        discountPaise: requestedDiscountPaise,
      });

      const {
        basePaise,
        nightPaise,
        highwayPaise,
        accidentPaise,
        waitingPaise,
        surgePaise,
        discountPaise,
        totalPaise,
      } = fare;
      const commission = commissionPaise(totalPaise, band);
      const poolPaise = totalPaise - commission;

      const settled = status === 'paid';
      const progressed = ['paid', 'completed', 'disputed', 'in_progress'].includes(status);
      const paidAt = settled
        ? new Date(createdAt.getTime() + (45 + Math.floor(rng() * 105)) * MINUTE_MS)
        : null;

      const pickupArea = pick(rng, areas);
      const dropArea = pick(rng, areas);
      const pickup = jitter(rng, { lat: pickupArea[1], lng: pickupArea[2] });
      const isLongHaul = distanceKm > 100;
      const otherCity = fleetKey === 'chr' ? FLEETS[0]! : FLEETS[1]!;
      const drop = isLongHaul
        ? centroid(otherCity.areas)
        : jitter(rng, { lat: dropArea[1], lng: dropArea[2] });
      const hasDrop = service === 'tow' || service === 'accident_recovery';

      const cancelledByDriver = status === 'cancelled' && driver !== null && rng() < 0.25;
      const cancellationFeePaise =
        status === 'cancelled' && driver !== null && !cancelledByDriver
          ? rng() < 0.85
            ? 15_000
            : basePaise
          : 0;

      bookingRows.push({
        userId: forcedCustomerId ?? pick(rng, customerRows).id,
        driverId: driver?.id ?? null,
        fleetId: fleet?.id ?? null,
        zoneId: fleet?.zoneId ?? fleetByKey.get('lakshmi')!.zoneId,
        serviceType: service,
        vehicleClass,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        pickupAddress: `${pickupArea[0]}`,
        dropLat: hasDrop ? drop.lat : null,
        dropLng: hasDrop ? drop.lng : null,
        dropAddress: hasDrop
          ? isLongHaul
            ? `${otherCity.areas[0]![0]} (long-distance)`
            : `${dropArea[0]}`
          : null,
        distanceKm: distanceKm.toFixed(2),
        status: status as BookingInsert['status'],
        baseFare: toRupees(basePaise),
        nightCharge: toRupees(nightPaise),
        highwayCharge: toRupees(highwayPaise),
        accidentCharge: toRupees(accidentPaise),
        waitingCharge: toRupees(waitingPaise),
        surgeAmount: toRupees(surgePaise),
        discount: toRupees(discountPaise),
        total: toRupees(totalPaise),
        commissionBand: band,
        commissionPct: BAND_PCT[band].toFixed(2),
        commissionAmount: progressed || settled ? toRupees(commission) : '0.00',
        driverPayout: progressed || settled ? toRupees(poolPaise) : '0.00',
        bookingOtpHash: driver ? otpCodeHash(rng) : null,
        otpVerified: progressed,

        /**
         * §7.4's waiting rules, snapshotted as §3.4 requires (migration 0015).
         *
         * The seed is the executable specification for a booking's shape, so a
         * seeded row that lacked these would be a booking `complete` could not
         * finalize the same way a real one does — and the fallback it takes
         * instead (15 / ₹5) would silently agree, hiding the gap.
         *
         * Written unconditionally rather than only for progressed bookings: they
         * are locked at CONFIRM, so every booking has them from the moment it
         * exists, including one that was cancelled during the search.
         */
        waitingFreeMinutes: DEFAULT_CHARGE_CONFIG.waitingFreeMinutes,
        waitingPerMinute: toRupees(DEFAULT_CHARGE_CONFIG.waitingPerMinutePaise),

        /**
         * §5.2's instants for the bookings that reached those states.
         *
         * `booking_status_history` already carries the transitions; these are the
         * denormalised copies the app renders from, and a seeded `completed`
         * booking with a null `completed_at` would make the fixture data
         * distinguishable from real data in exactly the place Phase 18's screens
         * read.
         */
        arrivedAt: progressed ? new Date(createdAt.getTime() + 12 * 60_000) : null,
        startedAt: progressed ? new Date(createdAt.getTime() + 18 * 60_000) : null,
        completedAt: settled || status === 'completed' ? (paidAt ?? createdAt) : null,
        cancelledBy: status === 'cancelled' ? (cancelledByDriver ? 'driver' : 'customer') : null,
        cancellationReason:
          status === 'cancelled' ? (cancelledByDriver ? 'Vehicle issue' : 'Customer cancelled') : null,
        cancellationFee: toRupees(cancellationFeePaise),
        paymentMethod: settled
          ? (weighted(rng, [
              ['upi', 70],
              ['card', 20],
              ['wallet', 10],
            ] as const) as BookingInsert['paymentMethod'])
          : null,
        createdAt,
        updatedAt: paidAt ?? createdAt,
      });

      perBooking.push({
        status,
        driver,
        fleetKey,
        createdAt,
        paidAt,
        totalPaise,
        commissionPaise: commission,
        poolPaise,
      });
    };

    const randomHistoricalDate = (): Date => {
      // Bias toward recent days so week-over-week charts slope upward.
      const daysAgo = Math.pow(rng(), 1.35) * HISTORY_DAYS;
      const at = new Date(now.getTime() - daysAgo * DAY_MS);
      at.setHours(Math.floor(rng() * 24), Math.floor(rng() * 60), Math.floor(rng() * 60), 0);
      return at;
    };

    for (const [key, count] of Object.entries(BOOKINGS_PER_FLEET) as Array<
      [FleetFixture['key'], number]
    >) {
      for (let i = 0; i < count * scale; i += 1) {
        generate(key, weighted(rng, HISTORICAL_MIX), randomHistoricalDate());
      }
    }
    for (let i = 0; i < INDEPENDENT_BOOKINGS * scale; i += 1) {
      generate(null, weighted(rng, HISTORICAL_MIX), randomHistoricalDate());
    }

    // Live bookings for the map/simulator to advance (§5.1 forward path).
    const liveStatuses: ReadonlyArray<readonly [FleetFixture['key'], string]> = [
      ['lakshmi', 'assigned'],
      ['lakshmi', 'en_route'],
      ['lakshmi', 'arrived'],
      ['lakshmi', 'in_progress'],
      ['chr', 'en_route'],
      ['chr', 'in_progress'],
    ];
    const liveDrivers = new Set<string>();
    // ONE ACTIVE BOOKING PER CUSTOMER (§3.8) is a partial UNIQUE index as of
    // migration 0012, so the six live rows must land on six DIFFERENT customers.
    //
    // They used to take `pick(rng, customerRows)` like every other booking. With
    // 20 customers and 6 draws that is a better-than-even chance of a collision
    // — it passed only because the fixed RNG happened to miss, and any edit to
    // an earlier random draw (Phase 14 made several) would have shifted the
    // stream and turned `pnpm db:reset` into a constraint violation. Walking the
    // list makes it a property of the seed rather than of the seed value.
    liveStatuses.forEach(([key, status], index) => {
      const candidates = seededDrivers.filter((d) => d.fleetKey === key && !liveDrivers.has(d.id));
      const driver = candidates[0] ?? seededDrivers.find((d) => d.fleetKey === key)!;
      liveDrivers.add(driver.id);
      generate(
        key,
        status,
        new Date(now.getTime() - (10 + Math.floor(rng() * 40)) * MINUTE_MS),
        driver,
        customerRows[index % customerRows.length]!.id,
      );
    });

    const bookingIds: string[] = [];
    await insertChunked(
      async (chunk) => {
        const rows = await tx.insert(bookings).values(chunk).returning({ id: bookings.id });
        bookingIds.push(...rows.map((r) => r.id));
      },
      bookingRows,
      chunkSize,
    );
    summary.bookings = bookingIds.length;

    // ── Status history, payments, ledger ────────────────────────────────────
    const historyRows: HistoryInsert[] = [];
    const paymentRows: PaymentInsert[] = [];
    const ledgerRows: LedgerInsert[] = [];

    perBooking.forEach((b, i) => {
      const id = bookingIds[i]!;
      historyRows.push({ bookingId: id, status: 'searching', actor: 'system', createdAt: b.createdAt });

      if (b.driver) {
        historyRows.push({
          bookingId: id,
          status: 'assigned',
          actor: 'driver',
          createdAt: new Date(b.createdAt.getTime() + 2 * MINUTE_MS),
        });
      }

      if (b.status === 'paid') {
        historyRows.push(
          {
            bookingId: id,
            status: 'completed',
            actor: 'driver',
            createdAt: new Date(b.paidAt!.getTime() - 15 * MINUTE_MS),
          },
          { bookingId: id, status: 'paid', actor: 'system', createdAt: b.paidAt! },
        );

        paymentRows.push({
          bookingId: id,
          gatewayRef: `pay_seed_${i}`,
          amount: toRupees(b.totalPaise),
          method: bookingRows[i]!.paymentMethod ?? 'upi',
          status: 'captured',
          idempotencyKey: `seed:v1:pay:${i}`,
          // Phase 19 columns. `purpose` is what lets a §3.5 cancellation fee
          // coexist with a fare on one booking under
          // `uq_payments_one_captured_per_booking`.
          purpose: 'booking',
          provider: 'dev',
          capturedAt: b.paidAt!,
          createdAt: b.paidAt!,
          updatedAt: b.paidAt!,
        });

        // §14.3: pool splits at the payout layer; ledger legs must sum to the
        // pool exactly (verified by the invariant query below).
        if (b.driver!.fleetKey) {
          const { driverPaise, fleetPaise } = splitPool(b.poolPaise, b.driver!.driverSharePct);
          const driverWallet = driverWallets.get(b.driver!.id)!;
          const fleetWallet = fleetWallets.get(b.driver!.fleetKey)!;
          ledgerRows.push(
            {
              walletId: driverWallet,
              type: 'driver_share_credit',
              amount: toRupees(driverPaise),
              reason: `Net earning (${b.driver!.driverSharePct}% of pool)`,
              refId: id,
              idempotencyKey: `seed:v1:bk:${i}:driver`,
              createdAt: b.paidAt!,
            },
            {
              walletId: fleetWallet,
              type: 'fleet_share_credit',
              amount: toRupees(fleetPaise),
              reason: `Fleet share (${100 - b.driver!.driverSharePct}% of pool)`,
              refId: id,
              idempotencyKey: `seed:v1:bk:${i}:fleet`,
              createdAt: b.paidAt!,
            },
          );
          credit(driverWallet, driverPaise);
          credit(fleetWallet, fleetPaise);
        } else {
          const driverWallet = driverWallets.get(b.driver!.id)!;
          ledgerRows.push({
            walletId: driverWallet,
            type: 'fare_credit',
            amount: toRupees(b.poolPaise),
            reason: 'Net fare after commission (independent)',
            refId: id,
            idempotencyKey: `seed:v1:bk:${i}:net`,
            createdAt: b.paidAt!,
          });
          credit(driverWallet, b.poolPaise);
        }
      } else if (b.status === 'cancelled') {
        historyRows.push({
          bookingId: id,
          status: 'cancelled',
          actor: bookingRows[i]!.cancelledBy ?? 'customer',
          createdAt: new Date(b.createdAt.getTime() + (3 + Math.floor(rng() * 12)) * MINUTE_MS),
        });
      } else if (b.status === 'no_drivers_found') {
        historyRows.push({
          bookingId: id,
          status: 'no_drivers_found',
          actor: 'system',
          createdAt: new Date(b.createdAt.getTime() + 3 * MINUTE_MS),
        });
      } else if (b.driver && b.status !== 'assigned') {
        historyRows.push({
          bookingId: id,
          status: b.status as HistoryInsert['status'],
          actor: 'driver',
          createdAt: new Date(b.createdAt.getTime() + 8 * MINUTE_MS),
        });
      }
    });

    await insertChunked(
      async (chunk) => {
        await tx.insert(bookingStatusHistory).values(chunk);
      },
      historyRows,
      200,
    );
    summary.historyRows = historyRows.length;

    await insertChunked(
      async (chunk) => {
        await tx.insert(payments).values(chunk);
      },
      paymentRows,
      100,
    );
    summary.payments = paymentRows.length;

    // ── Payouts ────────────────────────────────────────────────────────────
    //
    // The wallet is debited at REQUEST time, not when the payout reaches `paid`.
    // In a signed append-only ledger a hold IS a debit: if a `requested` or
    // `processing` payout carried no debit, the balance would still show the
    // money as available and a fleet could request it twice. A failure does not
    // remove the debit — §14.5 requires "compensating ledger entries (never
    // edits)" — it writes an `adjustment` credit that returns the funds.
    //
    // This mirrors `PayoutsService` exactly, which is the point: the seed is
    // the executable specification for the ledger's transaction shapes, so it
    // must not encode a second, older one.
    type PayoutInsert = typeof payouts.$inferInsert;
    interface PayoutSpec {
      row: PayoutInsert;
      walletId: string;
      paise: number;
      status: 'paid' | 'failed';
      requestedAt: Date;
    }
    const payoutSpecs: PayoutSpec[] = [];
    let payoutSeq = 0;

    const roundToHundredRupees = (paise: number) => Math.floor(paise / 10_000) * 10_000;

    const addPayout = (
      walletId: string,
      ownerId: string,
      ownerType: 'driver' | 'fleet',
      paise: number,
      daysAgo: number,
      status: 'paid' | 'failed',
    ) => {
      if (paise <= 0) return;
      const requestedAt = new Date(now.getTime() - daysAgo * DAY_MS);
      const seq = payoutSeq++;
      payoutSpecs.push({
        walletId,
        paise,
        status,
        requestedAt,
        row: {
          ownerId,
          ownerType,
          amount: toRupees(paise),
          routeRef: status === 'paid' ? `route_seed_${seq}` : null,
          status,
          failureReason:
            status === 'failed' ? 'Beneficiary bank rejected the account details' : null,
          provider: 'seed',
          idempotencyKey: `seed:v1:po:${seq}`,
          requestedAt,
          updatedAt: requestedAt,
          paidAt: status === 'paid' ? new Date(requestedAt.getTime() + 6 * 3_600_000) : null,
        },
      });
      // Net effect on the balance: paid → −paise; failed → −paise then +paise,
      // i.e. zero. The reversal rows are appended once the ids come back.
      if (status === 'paid') credit(walletId, -paise);
    };

    for (const [key, fleet] of fleetByKey) {
      const walletId = fleetWallets.get(key)!;
      const accumulated = walletSums.get(walletId) ?? 0;
      addPayout(walletId, fleet.id, 'fleet', roundToHundredRupees(accumulated * 0.4), 25, 'paid');
      addPayout(walletId, fleet.id, 'fleet', roundToHundredRupees(accumulated * 0.25), 12, 'paid');
      if (key === 'lakshmi') {
        // Matches the console's alert-feed story: a recent failed payout.
        const failed = Math.min(4_230_000, walletSums.get(walletId) ?? 0);
        addPayout(walletId, fleet.id, 'fleet', failed, 1, 'failed');
      }
    }

    const topDrivers = [...driverWallets.entries()]
      .map(([driverId, walletId]) => ({ driverId, walletId, sum: walletSums.get(walletId) ?? 0 }))
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 5);
    for (const { driverId, walletId, sum } of topDrivers) {
      addPayout(walletId, driverId, 'driver', roundToHundredRupees(sum * 0.5), 7, 'paid');
    }

    // Inserted with RETURNING so every ledger leg can carry `ref_id = payout.id`
    // — the join that makes "which payout moved this money?" answerable without
    // parsing an idempotency key. Postgres preserves VALUES order in RETURNING,
    // so the specs and the ids line up index for index.
    const insertedPayouts = await tx
      .insert(payouts)
      .values(payoutSpecs.map((s) => s.row))
      .returning({ id: payouts.id });
    summary.payouts = insertedPayouts.length;

    payoutSpecs.forEach((spec, i) => {
      const payoutId = insertedPayouts[i]!.id;
      ledgerRows.push({
        walletId: spec.walletId,
        type: 'payout_debit',
        amount: toRupees(-spec.paise),
        reason: 'Payout to bank (Razorpay Route)',
        refId: payoutId,
        idempotencyKey: `seed:v1:po:${payoutId}:debit`,
        createdAt: spec.requestedAt,
      });
      if (spec.status === 'failed') {
        ledgerRows.push({
          walletId: spec.walletId,
          type: 'adjustment',
          amount: toRupees(spec.paise),
          reason: 'Payout failed — funds returned',
          refId: payoutId,
          idempotencyKey: `seed:v1:po:${payoutId}:reversal`,
          createdAt: new Date(spec.requestedAt.getTime() + 30 * MINUTE_MS),
        });
      }
    });

    await insertChunked(
      async (chunk) => {
        await tx.insert(walletTransactions).values(chunk);
      },
      ledgerRows,
      200,
    );
    summary.ledgerRows = ledgerRows.length;

    // ── Balances = SUM(ledger), written last (§14.1: balance is a projection)
    for (const [walletId, sum] of walletSums) {
      await tx.execute(
        sql`update wallets set balance = ${toRupees(sum)}, updated_at = now() where id = ${walletId}`,
      );
    }
  });

  // ── Alerts, from the same engine that runs hourly in production.
  //
  // Since Phase 6 the dashboard reads STORED alerts, so a fresh seed would show
  // an empty alert feed and every truck dispatchable until the first cron tick.
  // Running the real sweep here (rather than hand-inserting alert rows) also
  // means the seeded compliance expiries and the truck statuses they imply
  // cannot drift apart.
  const sweep = await runComplianceSweep(db, { now });
  summary.alerts = sweep.alertsOpened;
  summary.trucksBlocked = sweep.trucksBlocked;

  // ── The earnings projection, from the same engine the worker runs.
  //
  // Same discipline as the alerts above: run the real projector rather than
  // hand-inserting `earnings_daily` rows, so a fresh seed cannot produce a
  // projection the production code path would never have produced. It also
  // means every `pnpm db:seed` and every `seed.spec.ts` run exercises the
  // projector over 506 bookings — the cheapest integration test in the repo.
  const rebuilt = await rebuildEarnings(db, { sinceDays: HISTORY_DAYS + 1, now });
  summary.earningsCells = rebuilt.cells;

  return summary;
}

/**
 * The three money invariants. All counts must be zero on a healthy database.
 *
 * The queries moved to `src/db/ledger/invariants.ts` in Phase 7 so the seed,
 * the test suite and the nightly reconciliation job assert the same three
 * things. This stays as the seed's entry point — `db/seed/index.ts` and
 * `seed.spec.ts` both call it — but there is now exactly one definition.
 */
export async function verifySeedInvariants(db: SeedDatabase): Promise<SeedInvariants> {
  return ledgerInvariants(db);
}
