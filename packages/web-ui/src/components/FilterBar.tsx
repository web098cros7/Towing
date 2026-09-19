import { cn } from '../lib/cn';

/**
 * The filter row above a table (W1 §3.3). A layout primitive with an
 * accessible group name — not a state container: filters are URL/query-param
 * state on every admin screen, and a component that held them would fight the
 * back button.
 */
export function FilterBar({
  children,
  className,
  'aria-label': ariaLabel = 'Filters',
}: {
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex flex-wrap items-end gap-3', className)}
    >
      {children}
    </div>
  );
}
