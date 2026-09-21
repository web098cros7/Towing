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
  icon,
  trend,
  tone,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Optional leading icon (e.g. a lucide element) for scannability. */
  icon?: React.ReactNode;
  /** Optional small trend line rendered beside the hint (e.g. "+4.2%"). */
  trend?: string;
  /** Accent tone for the value — defaults to primary text. */
  tone?: 'default' | 'success' | 'warning' | 'error' | 'brand';
  className?: string;
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'error'
          ? 'text-error'
          : tone === 'brand'
            ? 'text-brand'
            : undefined;
  return (
    <Card
      className={cn(
        'transition-shadow duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]',
        className,
      )}
    >
      <CardHeader className="flex-row items-center gap-2 pb-0">
        {icon ? <span className="text-text-tertiary [&_svg]:size-4">{icon}</span> : null}
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <div className={cn('text-3xl font-bold tabular-nums tracking-tight', toneClass)}>
          {value}
        </div>
        {hint || trend ? (
          <p className="mt-1 flex items-center gap-2 text-xs text-text-tertiary">
            {hint ? <span>{hint}</span> : null}
            {trend ? (
              <span className="rounded-full bg-surface1 px-1.5 py-0.5 font-medium tabular-nums">
                {trend}
              </span>
            ) : null}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
