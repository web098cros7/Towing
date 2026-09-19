'use client';

import { useEffect, useRef } from 'react';
import { cn } from '../lib/cn';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name; wired to `aria-labelledby`. */
  labelledBy: string;
  side?: 'right' | 'left';
  className?: string;
  children: React.ReactNode;
}

/**
 * A side sheet on the native `<dialog>` element (W1 §3.3), the same platform
 * base as `Dialog`: `showModal()` gives focus trapping, Escape-to-close and
 * background inertness for free.
 *
 * `m-0` + edge anchoring overrides the platform's centred default; the height
 * is `100dvh` so mobile browser chrome does not clip the footer actions.
 *
 * The hand-rolled drawers this is meant to replace (`PayoutDecisionDrawer`,
 * `DriverKycDrawer`, `ComplianceDrawer`, `BulkImportDrawer`) each reimplemented
 * focus handling differently; migrating them is deliberate follow-up work, not
 * part of W1 — a drawer rewrite inside a permissions milestone is how two
 * unrelated regressions become one diff.
 */
export function Drawer({
  open,
  onClose,
  labelledBy,
  side = 'right',
  className,
  children,
}: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'm-0 h-[100dvh] w-[min(28rem,calc(100vw-2rem))] max-w-none translate-x-0 rounded-none border-border bg-card p-0 text-text-primary shadow-xl',
        'backdrop:bg-black/50',
        side === 'right' ? 'ml-auto border-l' : 'mr-auto border-r',
        className,
      )}
    >
      <div className="flex h-full flex-col overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}

export function DrawerHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mb-4 space-y-1', className)} {...props} />;
}

export function DrawerTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('text-base font-semibold', className)} {...props} />;
}

export function DrawerBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex-1 space-y-4 text-sm', className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mt-5 flex justify-end gap-2', className)} {...props} />;
}
