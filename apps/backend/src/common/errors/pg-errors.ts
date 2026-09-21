/**
 * Postgres error inspection. Drizzle wraps driver errors (the postgres.js
 * error may sit on `cause`), so both levels are checked. Also exposes
 * helpers for CHECK violations, numeric overflow, and the violated
 * constraint's name.
 */
export function isUniqueViolation(err: unknown): boolean {
  return pgCode(err) === '23505';
}

/** True when a CHECK constraint refused the row (code '23514'). */
export function isCheckViolation(err: unknown): boolean {
  return pgCode(err) === '23514';
}

/** True when a number does not fit its column (code '22003'). */
export function isNumericOverflow(err: unknown): boolean {
  return pgCode(err) === '22003';
}

/**
 * The violated constraint's name, read from the error itself or its `cause`
 * (postgres.js puts it on the driver error, which Drizzle wraps in `cause`).
 */
export function constraintName(err: unknown): string | undefined {
  return pgField(err, 'constraint_name');
}

function pgCode(err: unknown): string | undefined {
  return pgField(err, 'code');
}

function pgField(err: unknown, key: string): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const direct = (err as Record<string, unknown>)[key];
  if (typeof direct === 'string') return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const nested = (cause as Record<string, unknown>)[key];
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}
