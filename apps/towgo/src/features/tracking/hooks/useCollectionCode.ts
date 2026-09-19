import { useEffect, useState } from 'react';
import { useBookingOtp } from '@/features/bookings/api/bookings.queries';

/** A failed read is retried quietly after this long; 24 draws no error state. */
const RETRY_AFTER_ERROR_MS = 10_000;
/** Read just after the window closes, so the server has certainly minted the next code. */
const EXPIRY_MARGIN_MS = 1_000;
/**
 * A read that comes back ALREADY lapsed by this device's clock (a clock running
 * ahead of the server's: the server returns the same code and `expiresAt`) is
 * read again after this long, until the server's window has closed too.
 */
const LAPSED_RETRY_MS = 5_000;

/**
 * Figma 24's collection code: the six digits, or `null` while there is no code
 * worth showing (the first read, a failed read, or a lapsed code being
 * replaced), when 24 shows six empty cells instead (spec Decision D5).
 *
 * THE CODE MUST NEVER BE A DEAD ONE. The server's window is 30 minutes from the
 * first read, and the first read after it mints a NEW code (`BookingOtpService`).
 * `useBookingOtp` alone would keep showing the old digits for as long as the
 * screen stays open, so this refetches silently at `expiresAt`. Inside the
 * window a refetch returns the same code, so the digits only ever change when
 * the old ones stopped working. A lapsed code is never shown: while the refetch
 * that replaces it is in flight (at expiry, or on mount over a lapsed cached
 * read) the cells are empty; if it fails, they stay empty and it tries again.
 */
export function useCollectionCode(bookingId: string, available: boolean): string | null {
  const { data, isError, isFetching, errorUpdatedAt, dataUpdatedAt, refetch } = useBookingOtp(
    bookingId,
    available,
  );
  const [now, setNow] = useState(() => Date.now());

  const expiresAt = data ? Date.parse(data.expiresAt) : null;

  // Refetch when the window closes. Re-armed by every successful read
  // (`dataUpdatedAt`), so a read that returns the same, already lapsed
  // `expiresAt` still schedules the next one.
  useEffect(() => {
    if (!available || expiresAt === null || Number.isNaN(expiresAt)) return;
    const untilExpiry = expiresAt - Date.now();
    const timer = setTimeout(
      () => {
        setNow(Date.now());
        void refetch();
      },
      untilExpiry > 0 ? untilExpiry + EXPIRY_MARGIN_MS : LAPSED_RETRY_MS,
    );
    return () => clearTimeout(timer);
  }, [available, dataUpdatedAt, expiresAt, refetch]);

  // A failed read keeps trying, quietly (each new failure restarts the wait).
  useEffect(() => {
    if (!available || !isError) return;
    const timer = setTimeout(() => void refetch(), RETRY_AFTER_ERROR_MS);
    return () => clearTimeout(timer);
  }, [available, errorUpdatedAt, isError, refetch]);

  if (!data) return null;
  const lapsed = expiresAt !== null && expiresAt <= Math.max(now, Date.now());
  return lapsed && (isError || isFetching) ? null : data.code;
}
