'use client';

import { Search, X } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * A debounce-free search box (W1 §3.3): the caller owns timing, because the
 * right cadence differs per screen — W2's admin table debounces 300 ms, while
 * W6's directory leans on the server's trigram index at 250 ms. Baking one
 * delay in here would silently override both.
 */
export function SearchInput({
  value,
  onValueChange,
  placeholder = 'Search',
  className,
  ...props
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
} & Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'>) {
  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        className={cn(
          'h-10 w-full rounded-input border border-border-strong bg-card pl-9 pr-9 text-sm text-text-primary',
          'placeholder:text-text-tertiary',
          'focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand/40',
          // The platform's own clear affordance would race ours for the same
          // pixel; the button below is the one with a label.
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
        {...props}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          data-testid="search-input-clear"
          onClick={() => onValueChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-tertiary hover:text-text-primary"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
