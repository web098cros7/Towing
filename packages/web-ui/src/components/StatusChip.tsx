import { Badge, type BadgeProps } from './Badge';

export type StatusTone = NonNullable<BadgeProps['variant']>;

/**
 * A status pill (W1 §3.3) — `Badge` plus the one convention every screen was
 * about to reinvent: `snake_case` → "Title Case", and an optional tone map.
 *
 * TONES ARE CALLER-SUPPLIED on purpose. The same string means different things
 * per domain (`pending` is amber in a payout queue and neutral in a KYC queue),
 * and a global map would force one of those to lie. When no map is given the
 * chip renders neutral, which is the honest default for an unknown status.
 */
export function StatusChip({
  status,
  tone,
  className,
  'data-testid': testId,
}: {
  status: string;
  tone?: StatusTone;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <Badge variant={tone ?? 'neutral'} className={className} data-testid={testId}>
      {humaniseStatus(status)}
    </Badge>
  );
}

/** `no_drivers_found` → `No drivers found`; already-spaced input passes through. */
export function humaniseStatus(status: string): string {
  const spaced = status.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
