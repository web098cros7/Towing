import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type JournalEntry = { idx: number; when: number; tag: string; breakpoints: boolean };
type Journal = { version: string; dialect: string; entries: JournalEntry[] };

/**
 * Drizzle's `migrate`, but each pending migration commits on its own.
 *
 * Drizzle runs every pending migration in ONE transaction. Postgres refuses to
 * use an enum value in the transaction that added it (`unsafe use of new value`),
 * so a database more than one migration behind fails as soon as a later
 * migration uses an earlier one's `ADD VALUE`: 0038 backfills drivers with
 * `lockout`, which 0035 adds. The live server (at 0034) would have died on it;
 * the local databases never did because they took each migration as it landed.
 *
 * So the journal is fed to drizzle one entry longer each time: every call finds
 * exactly one pending migration, runs it, and commits it before the next.
 * Bookkeeping stays drizzle's own (`drizzle.__drizzle_migrations`, same hashes),
 * so databases migrated either way stay interchangeable.
 */
export async function migrateStepwise<TSchema extends Record<string, unknown>>(
  db: PostgresJsDatabase<TSchema>,
  migrationsFolder: string,
): Promise<void> {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;

  const stage = mkdtempSync(join(tmpdir(), 'drizzle-stepwise-'));
  try {
    mkdirSync(join(stage, 'meta'));
    for (let i = 0; i < journal.entries.length; i += 1) {
      const entry = journal.entries[i]!;
      copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(stage, `${entry.tag}.sql`));
      writeFileSync(
        join(stage, 'meta', '_journal.json'),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, i + 1) }),
      );
      await migrate(db, { migrationsFolder: stage });
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
