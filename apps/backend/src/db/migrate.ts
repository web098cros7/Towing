import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadEnv } from '../config/env';
import { loadDotenv } from '../config/load-dotenv';
import { migrateStepwise } from './migrate-stepwise';

/**
 * Applies pending migrations, then exits. Run via `pnpm db:migrate`.
 *
 * Uses a dedicated single connection with `max: 1` — migrations must run
 * serially on one session so advisory locks and DDL transactions behave.
 */
async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();

  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });

  try {
    // One transaction per migration: see migrate-stepwise.ts.
    await migrateStepwise(drizzle(sql), resolve(__dirname, '../../drizzle'));
    console.log('migrations applied');
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error('migration failed:', error);
  process.exit(1);
});
