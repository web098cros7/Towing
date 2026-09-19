'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

/**
 * The console's toast surface (W1 §3.3 — the kit piece every write needs).
 *
 * Deliberately tiny: a queue, a 5-second dismissal, and `aria-live="polite"` so
 * a screen reader hears the confirmation a sighted operator sees. Errors do NOT
 * auto-dismiss on a shorter timer — they carry possible next actions, and
 * racing a human's reading speed is how error toasts "never appeared".
 */
export interface ToastMessage {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastMessage['kind']) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => undefined });

const KIND_CLASSES: Record<ToastMessage['kind'], string> = {
  info: 'border-border bg-card text-text-primary',
  success: 'border-success/40 bg-card text-text-primary',
  error: 'border-danger/50 bg-card text-text-primary',
};

const AUTO_DISMISS_MS: Record<ToastMessage['kind'], number> = {
  info: 5_000,
  success: 5_000,
  // Long enough to read and act on; the operator dismisses it.
  error: 30_000,
};

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string, kind: ToastMessage['kind'] = 'info') => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current, { id, message, kind }]);
    // A timer per toast; the setState after unmount is a no-op for React 19.
    setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== id));
    }, AUTO_DISMISS_MS[kind]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        data-testid="toast-region"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
      >
        {toasts.map((entry) => (
          <div
            key={entry.id}
            data-testid={`toast-${entry.kind}`}
            role="status"
            className={`pointer-events-auto rounded-card border px-4 py-3 text-sm shadow-lg ${KIND_CLASSES[entry.kind]}`}
          >
            {entry.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue['toast'] {
  return useContext(ToastContext).toast;
}
