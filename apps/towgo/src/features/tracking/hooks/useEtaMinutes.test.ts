import { act, renderHook } from '@testing-library/react-native';
import type { BookingTracking } from '@towing/api-contracts';
import { useEtaMinutes } from './useEtaMinutes';

/**
 * The count behind every "Arriving in N mins" in the app.
 *
 * The case that matters is the leg change: `etaSeconds` describes the pickup
 * while the driver is coming and the drop once the tow starts, and the app can
 * learn of the new status a beat before it receives an ETA for it. Showing the
 * old leg's number then is the bug these tests exist to keep out.
 *
 * `renderHook`, `rerender` and `act` are all asynchronous in this version of
 * the testing library — each one must be awaited or the assertion runs before
 * React has committed.
 */

/** Only the fields the hook reads; the rest of the payload is irrelevant here. */
function tracking(status: BookingTracking['status'], etaSeconds: number | null, at: string) {
  return { status, etaSeconds, at } as unknown as BookingTracking;
}

describe('useEtaMinutes', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports the rounded minutes of the current ETA', async () => {
    const { result } = await renderHook(() =>
      useEtaMinutes(tracking('en_route', 300, '2026-09-23T10:00:00.000Z')),
    );
    expect(result.current).toBe(5);
  });

  it('ticks down between server values', async () => {
    const { result } = await renderHook(() =>
      useEtaMinutes(tracking('en_route', 300, '2026-09-23T10:00:00.000Z')),
    );
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(4);
  });

  it('floors at one minute rather than reaching zero', async () => {
    const { result } = await renderHook(() =>
      useEtaMinutes(tracking('en_route', 20, '2026-09-23T10:00:00.000Z')),
    );
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(1);
  });

  it('drops the count when the leg changes, instead of showing the old one', async () => {
    const { result, rerender } = await renderHook(({ t }: { t: BookingTracking }) => useEtaMinutes(t), {
      initialProps: { t: tracking('en_route', 180, '2026-09-23T10:00:00.000Z') },
    });
    expect(result.current).toBe(3);

    // The tow starts. The ETA in hand is still the pickup's — the payload that
    // knows the drop has not arrived yet.
    await rerender({ t: tracking('in_progress', 180, '2026-09-23T10:00:00.000Z') });
    expect(result.current).toBeNull();
  });

  it('counts again once an ETA for the new leg arrives', async () => {
    const { result, rerender } = await renderHook(({ t }: { t: BookingTracking }) => useEtaMinutes(t), {
      initialProps: { t: tracking('en_route', 180, '2026-09-23T10:00:00.000Z') },
    });
    await rerender({ t: tracking('in_progress', 180, '2026-09-23T10:00:00.000Z') });
    expect(result.current).toBeNull();

    await rerender({ t: tracking('in_progress', 1_800, '2026-09-23T10:00:30.000Z') });
    expect(result.current).toBe(30);
  });

  it('keeps the last known count when a later payload has no ETA', async () => {
    const { result, rerender } = await renderHook(({ t }: { t: BookingTracking }) => useEtaMinutes(t), {
      initialProps: { t: tracking('en_route', 300, '2026-09-23T10:00:00.000Z') },
    });
    await rerender({ t: tracking('en_route', null, '2026-09-23T10:00:10.000Z') });
    expect(result.current).toBe(5);
  });
});
