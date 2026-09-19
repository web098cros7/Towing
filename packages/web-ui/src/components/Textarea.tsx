import { cn } from '../lib/cn';

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      rows={4}
      className={cn(
        'w-full rounded-input border border-border-strong bg-card px-3 py-2 text-sm text-text-primary',
        'placeholder:text-text-tertiary',
        'focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-error',
        className,
      )}
      {...props}
    />
  );
}
