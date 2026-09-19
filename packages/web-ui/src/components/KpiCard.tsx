import { Card, CardContent, CardHeader, CardTitle } from './Card';
import { cn } from '../lib/cn';

/**
 * A single KPI tile (W1 §3.3) — lifted from the fleet dashboard's local
 * component so the admin dashboard (W3) and the fleet dashboard render the
 * same numbers at the same size.
 */
export function KpiCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-0">
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <div className={cn('text-3xl font-bold tabular-nums')}>{value}</div>
        {hint ? <p className="mt-1 text-xs text-text-tertiary">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
