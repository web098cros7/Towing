import { cn } from '../lib/cn';

/**
 * Formats a rupee amount for display. Mirrors `lib/money.ts` in the console
 * (integer paise → no decimals when whole, two when not) but accepts what the
 * ADMIN APIs actually return — NUMERIC columns arrive as strings like
 * `"20000.00"`, and routing those through `Number()` here is safe because they
 * never exceed 2^53/100.
 */
export function Money({
  value,
  exact = false,
  className,
}: {
  value: string | number | null | undefined;
  /** Force two decimals even when the value is whole. */
  exact?: boolean;
  className?: string;
}) {
  const parsed = parseAmount(value);
  return (
    <span
      className={cn('tabular-nums', className)}
      data-testid={value == null ? 'money-empty' : undefined}
    >
      {parsed === null ? '—' : formatInr(parsed, exact)}
    </span>
  );
}

function parseAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatInr(amount: number, exact: boolean): string {
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: exact || amount % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return formatter.format(amount);
}
