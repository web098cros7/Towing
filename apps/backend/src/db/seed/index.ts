import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadEnv } from '../../config/env';
import { loadDotenv } from '../../config/load-dotenv';
import * as schema from '../schema';
import { ADMIN_FIXTURES, FLEETS, SEED_PASSWORD } from './fixtures';
import { runSeed, verifySeedInvariants } from './seed';

/**
 * CLI wrapper around `runSeed` (`pnpm db:seed`, `pnpm db:reset` for --reset).
 * The seeding logic itself lives in ./seed.ts so the vitest suite can run the
 * identical seed against the throwaway test stack.
 */
async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const scale = parseScale(process.argv);

  loadDotenv();
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    throw new Error('db:seed refuses to run with NODE_ENV=production');
  }

  const client = postgres(env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  const db = drizzle(client, { schema });

  try {
    const startedAt = Date.now();
    const summary = await runSeed(db, { reset, scale });

    if (!summary) {
      console.log('Database already seeded. Run `pnpm db:reset` to wipe and reseed.');
      return;
    }

    if (scale > 1) {
      console.log(
        `[seed] scale=${scale} — ${summary.bookings} bookings, ${summary.ledgerRows} ledger rows, ` +
          `${summary.earningsCells} projection cells in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      );
    }

    // The invariants are scale-independent, which is what lets `--scale` ship
    // with no automated test of its own: a ×10 seed exceeds vitest's timeout,
    // but every run of it verifies the same §14 properties that
    // `seed.spec.ts` pins at scale 1.
    const invariants = await verifySeedInvariants(db);
    console.log(
      `[seed] invariants — wallet balance drift: ${invariants.walletDrift}, ` +
        `booking money drift: ${invariants.bookingDrift}, ledger-vs-payout drift: ${invariants.ledgerDrift}, ` +
        `reversal drift: ${invariants.reversalDrift}, coupon drift: ${invariants.couponDrift}`,
    );
    const drift =
      invariants.walletDrift +
      invariants.bookingDrift +
      invariants.ledgerDrift +
      invariants.reversalDrift +
      invariants.couponDrift;
    if (drift > 0) {
      throw new Error('seed invariants violated — see counts above');
    }

    console.log('[seed] done:', JSON.stringify(summary));
    console.log('');
    console.log('Console logins (password for all: ' + SEED_PASSWORD + '):');
    for (const fleet of FLEETS) {
      console.log(`  ${fleet.businessName}: ${fleet.owner.email}`);
    }
    console.log('');
    console.log('Admin logins (POST /v1/admin/auth/login, then the OTP step):');
    for (const admin of ADMIN_FIXTURES) {
      console.log(`  ${admin.subRole.padEnd(12)} ${admin.email}`);
    }
    console.log('');
    console.log('Next: `pnpm sim:locations` to stream truck movement.');
  } finally {
    await client.end({ timeout: 5 });
  }
}

/**
 * `--scale=N` multiplies booking volume for a load run (`pnpm db:seed:load`).
 * Capped at 50 because the seed runs in ONE transaction: past that the WAL and
 * the memory held by the pending row arrays stop being a good idea, and a typo
 * like `--scale=1000` should fail immediately rather than after ten minutes.
 */
function parseScale(argv: string[]): number {
  const flag = argv.find((arg) => arg.startsWith('--scale='));
  if (!flag) return 1;

  const value = Number(flag.slice('--scale='.length));
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error(`--scale must be an integer between 1 and 50 (got ${flag})`);
  }
  return value;
}

main().catch((error: unknown) => {
  console.error('[seed] failed:', error);
  process.exit(1);
});
