'use client';

import { cn } from '../lib/cn';

/**
 * Hover/focus tooltip (W1 §3.3) — CSS-only, no positioning library.
 *
 * Scoped to SHORT labels on controls that already have an accessible name
 * (icon buttons, truncated ids). It is not a rich popover: nothing focusable
 * may live inside, because a CSS `:hover` bubble cannot be reached by keyboard
 * itself — `group-focus-within` covers the control that owns it, which is the
 * only interaction this component promises.
 */
export function Tooltip({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute -top-8 left-1/2 z-50 hidden -translate-x-1/2',
          'whitespace-nowrap rounded-md bg-text-primary px-2 py-1 text-xs text-surface0 shadow-md',
          'group-hover:block group-focus-within:block',
        )}
      >
        {label}
      </span>
    </span>
  );
}
