import { cn } from '../lib/cn';

/**
 * Native `<select>` (W1 §3.3) — deliberately not a listbox reimplementation.
 * The platform control brings keyboard behaviour, mobile wheels and screen
 * reader support for free; the admin console has no need for option rendering
 * beyond text.
 */
export function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-input border border-border-strong bg-card px-2.5 text-sm text-text-primary',
        'focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
