import 'reflect-metadata';
import { afterAll } from 'vitest';
import { TEST_DATABASE_URL, TEST_REDIS_URL, closeTestDb } from './db';

/**
 * Repoint every env-driven module at the throwaway stack before any spec calls
 * `loadEnv()`. Plain assignment rather than `??=` on purpose: a developer with
 * DATABASE_URL exported in their shell must never have `truncateAll()` run
 * against their dev database.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.REDIS_URL = TEST_REDIS_URL;

// Deterministic, and long enough for the >= 32 char check in env.ts. Tests sign
// real access tokens with this, so it has to satisfy the same schema as prod.
process.env.JWT_ACCESS_SECRET ??= 'test-only-access-secret-at-least-32-chars-long';
process.env.JWT_ACCESS_TTL_SECONDS ??= '900';
process.env.JWT_REFRESH_TTL_SECONDS ??= '2592000';
process.env.FILE_SIGNING_SECRET ??= 'test-only-file-signing-secret-at-least-32-chars';

/**
 * Maps providers pinned to the offline ones, by plain assignment like the URLs
 * above. `createTestApp()` loads `apps/backend/.env`, and `loadEnvFile` only
 * fills UNSET vars: without this, a developer whose .env turns on Google (with a
 * real `GOOGLE_MAPS_API_KEY`) would have every booking spec call Google, spend
 * money, and fail wherever a spec expects the haversine distance. The fallback
 * specs that test the Google adapters build them directly.
 */
process.env.ROUTING_PROVIDER = 'haversine';
process.env.DIRECTIONS_PROVIDER = 'haversine';
process.env.GEOCODING_PROVIDER = 'local';

// Nest's bootstrap banner and pino's request lines drown the assertion output.
process.env.LOG_LEVEL ??= 'fatal';

/**
 * Background workers OFF by default.
 *
 * Every `createTestApp()` boots the full AppModule, so a live BullMQ worker
 * would sit on the shared test Redis racing the specs: a queued import would be
 * picked up and processed while the test is still asserting it is `pending`,
 * and leftover jobs would leak across files (`fileParallelism: false` orders
 * the files but does not drain a queue between them).
 *
 * `queue.e2e.spec.ts` flips this back on for itself — that is where the real
 * enqueue → process → retry → DLQ round trip is proven.
 */
process.env.QUEUE_ENABLED = 'false';

/**
 * The dev payout adapter's settle delay, shrunk from 5 s to effectively zero.
 *
 * With the queue off, `payouts.dev-settle` never runs, so the reconciliation
 * poll's `fetchPayout` is what settles a payout in tests — and it ages the
 * payout off the timestamp in the provider reference. At the production 5 s
 * every reconcile spec would have to sleep. Same idea as the 3 s token TTL the
 * Phase 4 refresh test uses: shorten the clock, keep the code path real.
 */
process.env.PAYOUT_DEV_SETTLE_MS ??= '1';

/**
 * prom-client metrics OFF in tests.
 *
 * Metrics are registered against a Registry owned by `MetricsModule`, so two
 * apps booted in one file (multi-instance.e2e.spec.ts, and the new throttle and
 * refresh-grace specs) each get their own. That is correct — but "correct
 * because the plumbing is right" is weaker than "cannot happen", and no spec
 * asserts on a counter. `metrics.e2e.spec.ts` turns it back on for itself.
 */
process.env.METRICS_ENABLED = 'false';

/**
 * ADM-16's authenticator requirement OFF by default.
 *
 * Hundreds of specs sign in as Super Admin or Finance to test something that
 * is not 2FA; with the requirement on, each would need an enrolled secret and a
 * live code first. `admin-totp-required.e2e.spec.ts` turns it back on and is
 * where the rule itself is proven.
 */
process.env.ADMIN_TOTP_REQUIRED = 'false';

/**
 * Throttling OFF by default — a Phase 8 consequence, not a convenience.
 *
 * The counter now lives in Redis, so it is shared by every app in the run AND
 * survives the file that created it: `isolate: true` gives each spec a fresh
 * module graph, but no longer a fresh counter. `payouts.e2e.spec.ts`
 * legitimately posts more than the money bucket's 20/min across its cases, and
 * it started 429ing the moment the storage became durable — which is precisely
 * the defect the shared storage exists to create.
 *
 * Rationing calls per file would only push the problem to whichever file grows
 * next. The specs that are ABOUT throttling turn it back on for themselves
 * (`tenant-throttler.guard.spec.ts`), and `redis-throttler.storage.spec.ts`
 * drives the storage directly, so coverage is unaffected.
 */
process.env.THROTTLE_DISABLED = '1';

// Pools are module singletons in src/test/db.ts; left open they keep the event
// loop alive and vitest hangs after the last assertion instead of exiting.
afterAll(async () => {
  await closeTestDb();
});
