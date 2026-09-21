'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, OctagonAlert } from 'lucide-react';
import { Input } from '@towing/web-ui';

/**
 * Shared login feedback kit: error banner, password visibility toggle,
 * resend-code cooldown and the post-login success beat.
 */

/** Icon error banner — `role="alert"` so screen readers announce it. */
export function AuthErrorBanner({ message }: { message: string }): React.ReactNode {
  return (
    <div
      role="alert"
      data-testid="auth-error"
      className="animate-admin-fade-in flex items-start gap-2.5 rounded-input border border-error/40 bg-error/10 px-3.5 py-3 text-sm text-text-primary"
    >
      <OctagonAlert className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

/** Password input with a show/hide toggle that never steals label association. */
export function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className="pr-10" />
      <button
        type="button"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-text-tertiary transition-colors hover:text-text-primary"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** Spinner shown inside submit buttons while a request is in flight. */
export function ButtonSpinner() {
  return <Loader2 className="size-4 animate-spin" aria-hidden />;
}

/**
 * Resend-code cooldown. Returns seconds left (0 = ready) and a starter.
 * The caller replays its credentials submit, then starts the timer.
 */
export function useResendCooldown(seconds = 30): { remaining: number; start: () => void } {
  const [remaining, setRemaining] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const start = () => {
    if (timer.current) clearInterval(timer.current);
    setRemaining(seconds);
    timer.current = setInterval(() => {
      setRemaining((left) => {
        if (left <= 1) {
          if (timer.current) clearInterval(timer.current);
          timer.current = null;
          return 0;
        }
        return left - 1;
      });
    }, 1000);
  };

  return { remaining, start };
}

/** Brief success beat shown between accepted credentials and the redirect. */
export function AuthSuccess({ title, message }: { title: string; message: string }) {
  return (
    <div
      className="animate-admin-pop-in flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center"
      role="status"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-success/10">
        <CheckCircle2 className="size-7 text-success" aria-hidden />
      </span>
      <p className="font-display text-xl font-bold">{title}</p>
      <p className="flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {message}
      </p>
    </div>
  );
}
