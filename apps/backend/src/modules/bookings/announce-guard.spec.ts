import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A18: every status change is announced.
 *
 * Two rules, enforced as source text in the style of `sole-writer.spec.ts` —
 * a review catches a missing `announce()` only if the reviewer remembers the
 * rule, and the failure mode is silence: no error, no test red, just an admin
 * console that never learns a booking moved.
 *
 * Rule 1: every file that moves a booking through `transition(` announces the
 * move in the same file. `announce()` itself publishes to `ops:events` before
 * the fleet-only early return, so one call covers both feeds.
 *
 * Rule 2: every file that writes `bookings` / `booking_status_history`
 * directly (bypassing the machine — only creation legitimately does)
 * publishes to the ops feed. Otherwise a status exists that no transition
 * ever produced and no subscriber ever heard about.
 */

const SRC = resolve(__dirname, '../..');

function sourceFiles(): string[] {
  const out: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        walk(full);
        continue;
      }
      if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
    }
  };

  walk(SRC);
  return out;
}

const rel = (file: string): string => relative(SRC, file).split(sep).join('/');

describe('every booking status change is announced (A18)', () => {
  // The seed, the fixtures and the load scripts build starting states —
  // none of them is a runtime status change.
  const ALLOWED_WRITERS = [
    'db/seed/seed.ts',
    'test/fixtures.ts',
    'modules/dispatch/dispatch-fixtures.ts',
    'scripts/simulate-locations.ts',
    'scripts/bench-tracking.ts',
  ];

  it('every file calling transition( also calls announce(', () => {
    const offenders = sourceFiles()
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return /\.transition\(/.test(source) && !/announce\(/.test(source);
      })
      .map(rel);

    expect(
      offenders,
      'These files move bookings without announcing. Call machine.announce() after the ' +
        'committing transaction (or OpsEventsService.publish for creation, which performs ' +
        'no transition) — an unannounced status change is invisible to the admin feed.',
    ).toEqual([]);
  });

  it('every direct bookings/history writer publishes to the ops feed', () => {
    // Bookings rows enter the world with no transition, so their files must
    // publish `booking_created`; history rows are written beside a transition
    // (or in tests), so theirs must announce. One rule per write kind keeps a
    // `booking_created` omission from hiding behind an unrelated `announce(`.
    const BOOKING_WRITE_PATTERNS = [/\.insert\(\s*bookings/, /insert\s+into\s+bookings/i];
    const HISTORY_WRITE_PATTERNS = [
      /\.insert\(\s*bookingStatusHistory/,
      /insert\s+into\s+booking_status_history/i,
    ];

    const offenders = sourceFiles()
      .filter((file) => !ALLOWED_WRITERS.includes(rel(file)))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        const writesBookings = BOOKING_WRITE_PATTERNS.some((pattern) => pattern.test(source));
        const writesHistory = HISTORY_WRITE_PATTERNS.some((pattern) => pattern.test(source));
        if (!writesBookings && !writesHistory) return false;
        if (writesBookings && !/booking_created/.test(source)) return true;
        if (writesHistory && !/announce\(/.test(source)) return true;
        return false;
      })
      .map(rel);

    expect(
      offenders,
      'These files write booking status without publishing. A status no transition ' +
        'produced and no feed carried is invisible to the admin console.',
    ).toEqual([]);
  });

  it('the writer allowlist has no stale entries', () => {
    const existing = new Set(sourceFiles().map(rel));
    expect(ALLOWED_WRITERS.filter((entry) => !existing.has(entry))).toEqual([]);
  });
});
