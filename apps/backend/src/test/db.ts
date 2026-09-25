import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrateStepwise } from '../db/migrate-stepwise';
import postgres from 'postgres';
import * as schema from '../db/schema';
import { adminUsers, drivers, fleets, payoutAccounts, users } from '../db/schema';
import { hashPassword } from '../modules/auth/password';

/**
 * The throwaway stack from apps/backend/docker-compose.yml (`--profile test`):
 * Postgres on 5433 with tmpfs storage and fsync off, Redis on 6380. Different
 * ports from the dev stack on purpose — `truncateAll()` empties every table it
 * can see, and pointing that at a developer's dev database would be unrecoverable.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://towfleet:towfleet@localhost:5433/towfleet_test';

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6380';

/** Printed verbatim when the stack is unreachable, so the fix is copy-pasteable. */
export const START_TEST_STACK_COMMAND =
  'cd apps/backend && docker compose --profile test up -d --wait';

export type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

let client: postgres.Sql | undefined;
let database: TestDatabase | undefined;
let migrated = false;
let truncatableTables: string[] | undefined;

function connect(): postgres.Sql {
  if (client) return client;

  client = postgres(TEST_DATABASE_URL, {
    // Rotation tests race two refreshes on purpose; one connection would
    // serialise them and the race would never happen.
    max: 5,
    // Default is 30s. A missing container should report in seconds, not after
    // vitest has already blown its hook timeout with no useful message.
    connect_timeout: 5,
    // Without this the pool keeps the event loop alive and vitest hangs after
    // the last assertion instead of exiting.
    idle_timeout: 5,
    prepare: false,
    onnotice: () => {},
  });

  return client;
}

/** The raw postgres.js handle — for invariant queries that are clearer as SQL. */
export function testSql(): postgres.Sql {
  return connect();
}

/** The Drizzle client, wired to the same schema the application uses. */
export function testDb(): TestDatabase {
  if (!database) database = drizzle(connect(), { schema });
  return database;
}

/**
 * Connect, verify the stack is actually up, and bring the schema to head.
 * Call from `beforeAll`. Migrating is idempotent (drizzle keeps its own
 * journal), so paying for it once per test file costs a single SELECT.
 */
export async function setupTestDatabase(): Promise<TestDatabase> {
  const sql = connect();

  try {
    await sql`select 1`;
  } catch (cause) {
    throw new Error(
      [
        `Cannot reach the test database at ${TEST_DATABASE_URL}.`,
        '',
        'Start the test stack with:',
        '',
        `  ${START_TEST_STACK_COMMAND}`,
        '',
        'Set TEST_DATABASE_URL to point somewhere else (CI service container, remote box).',
      ].join('\n'),
      { cause },
    );
  }

  if (!migrated) {
    // src/test → apps/backend/drizzle, matching src/db/migrate.ts.
    await migrateStepwise(testDb(), resolve(__dirname, '../../drizzle'));
    migrated = true;
  }

  return testDb();
}

/**
 * Empty every application table. Called from `beforeEach` so a suite never
 * inherits another's rows.
 *
 * One TRUNCATE for all tables: CASCADE on a single statement resolves the FK
 * graph itself, which is both faster than ordered DELETEs and immune to the
 * ordering breaking every time a foreign key is added.
 */
export async function truncateAll(): Promise<void> {
  const sql = connect();

  if (!truncatableTables) {
    const rows = await sql<{ tablename: string }[]>`
      select tablename
        from pg_tables
       where schemaname = 'public'
         -- PostGIS owns this one; truncating it would break every geography cast.
         and tablename <> 'spatial_ref_sys'
    `;
    truncatableTables = rows.map((row) => row.tablename);
  }

  if (truncatableTables.length === 0) return;

  const list = truncatableTables.map((name) => `"${name}"`).join(', ');
  await sql.unsafe(`truncate table ${list} restart identity cascade`);
}

/** Release the pool. Registered globally in src/test/setup.ts. */
export async function closeTestDb(): Promise<void> {
  if (!client) return;

  const closing = client;
  client = undefined;
  database = undefined;
  migrated = false;
  truncatableTables = undefined;

  await closing.end({ timeout: 5 });
}

/**
 * Collision-proof phone number. `users.mobile` and `drivers.mobile` are unique,
 * and truncation between tests does not help suites that seed several rows in
 * one test.
 */
export function uniqueMobile(): string {
  return `+9199${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
}

export async function seedCustomer(db: TestDatabase, name = 'Test Customer'): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ mobile: uniqueMobile(), name })
    .returning({ id: users.id });

  return row!.id;
}

/**
 * A fleet plus the owner user it is required to reference.
 *
 * Complete-profile by default (§9.3.1): the money routes are gated on
 * `profile_completed_at`, and every existing suite would start 403-ing the day
 * that guard landed. Pass `{ incomplete: true }` to get the pre-onboarding
 * state the gate's own spec needs.
 */
export async function seedFleet(
  db: TestDatabase,
  businessName: string,
  options: { incomplete?: boolean } = {},
): Promise<{ ownerId: string; fleetId: string }> {
  const ownerId = await seedCustomer(db, `${businessName} Owner`);
  const incomplete = options.incomplete ?? false;

  const [fleet] = await db
    .insert(fleets)
    .values({
      ownerId,
      businessName,
      status: 'active',
      address: incomplete ? null : '1 Test Road, Bengaluru 560001',
      onboardingStep: incomplete ? 'profile' : 'done',
      profileCompletedAt: incomplete ? null : new Date(),
    })
    .returning({ id: fleets.id });

  return { ownerId, fleetId: fleet!.id };
}

/**
 * An `active` Route linked account for a fleet — what `POST /fleet/payouts`
 * requires as a destination. Separate from `seedFleet` on purpose: "profile
 * complete" and "bank linked" are two distinct preconditions and the payout
 * specs assert each failing on its own.
 */
export async function seedPayoutAccount(
  db: TestDatabase,
  ownerId: string,
  options: { ownerType?: 'fleet' | 'driver'; status?: 'unlinked' | 'pending' | 'active' } = {},
): Promise<string> {
  const status = options.status ?? 'active';

  const [row] = await db
    .insert(payoutAccounts)
    .values({
      ownerId,
      ownerType: options.ownerType ?? 'fleet',
      status,
      // `ck_payout_accounts_active_has_destination` requires this on `active`.
      routeAccountId: status === 'unlinked' ? null : `acc_test_${randomUUID().slice(0, 8)}`,
      routeFundAccountId: status === 'active' ? `fa_test_${randomUUID().slice(0, 8)}` : null,
      beneficiaryName: 'Test Beneficiary',
      accountNumberLast4: '4021',
      ifsc: 'HDFC0000123',
      bankName: 'HDFC Bank',
      linkedAt: status === 'active' ? new Date() : null,
    })
    .returning({ id: payoutAccounts.id });

  return row!.id;
}

/**
 * An admin operator. `operations` by default because that is the sub-role with
 * the KYC permission — a spec asserting the RBAC negative passes `support`.
 */
export async function seedAdmin(
  db: TestDatabase,
  options: { subRole?: 'super_admin' | 'operations' | 'support' | 'finance'; password?: string } = {},
): Promise<{ id: string; email: string; mobile: string }> {
  const suffix = randomUUID().slice(0, 8);
  const email = `admin-${suffix}@towing.test`;
  const mobile = uniqueMobile();

  const [row] = await db
    .insert(adminUsers)
    .values({
      email,
      mobile,
      name: 'Test Admin',
      // A real scrypt hash only when a spec intends to log in — hashing is
      // deliberately slow, and most specs mint a token directly.
      passwordHash: options.password ? await hashPassword(options.password) : 'scrypt$unusable',
      subRole: options.subRole ?? 'operations',
    })
    .returning({ id: adminUsers.id });

  return { id: row!.id, email, mobile };
}

/** KYC-approved by default — a pending driver can never appear on a booking (§3.1). */
export async function seedDriver(
  db: TestDatabase,
  options: {
    fleetId?: string;
    name?: string;
    kycStatus?: 'approved' | 'pending' | 'incomplete' | 'rejected' | 'suspended';
    vehicleClass?: 'wheel_lift' | 'flatbed' | null;
  } = {},
): Promise<string> {
  const [row] = await db
    .insert(drivers)
    .values({
      mobile: uniqueMobile(),
      name: options.name ?? 'Test Driver',
      fleetId: options.fleetId ?? null,
      kycStatus: options.kycStatus ?? 'approved',
      vehicleClass: options.vehicleClass === undefined ? 'flatbed' : options.vehicleClass,
    })
    .returning({ id: drivers.id });

  return row!.id;
}
