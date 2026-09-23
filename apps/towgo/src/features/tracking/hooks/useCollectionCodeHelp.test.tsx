import React from 'react';
import { Alert } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { bookingsDataSource } from '@/features/bookings/api/bookingsDataSource';
import { useCollectionCodeHelp } from './useCollectionCodeHelp';

/**
 * L17 and L16 on screen 24: what the customer is told when the code on screen
 * cannot help them. Both are system prompts, because 24 draws neither state.
 */

const LIVE = { code: '482719', expiresAt: new Date(Date.now() + 600_000).toISOString() };

function render(client: QueryClient) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCollectionCodeHelp('b1', true), { wrapper });
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

describe('useCollectionCodeHelp', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('says nothing while the code works', async () => {
    jest.spyOn(bookingsDataSource, 'getOtp').mockResolvedValue({ ...LIVE, locked: false });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const client = newClient();
    await render(client);
    await waitFor(() => expect(client.getQueryData(['bookings', 'otp', 'b1'])).toBeDefined());

    expect(alert).not.toHaveBeenCalled();
  });

  it('offers a new code once the driver has locked the old one, and uses it', async () => {
    jest.spyOn(bookingsDataSource, 'getOtp').mockResolvedValue({ ...LIVE, locked: true });
    const fresh = { code: '615203', expiresAt: LIVE.expiresAt, locked: false };
    const renew = jest.spyOn(bookingsDataSource, 'renewOtp').mockResolvedValue(fresh);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const client = newClient();
    await render(client);

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls[0]![0]).toBe("Your driver couldn't enter the code");

    // Tap "Get new code".
    const buttons = alert.mock.calls[0]![2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => {
      buttons.find((button) => button.text === 'Get new code')!.onPress!();
    });

    expect(renew).toHaveBeenCalledWith('b1');
    // The six digits on 24 read from this cache entry, so they change at once.
    await waitFor(() => expect(client.getQueryData(['bookings', 'otp', 'b1'])).toEqual(fresh));
  });

  it('tells the customer once when the code has failed to load for 30 seconds', async () => {
    jest.useFakeTimers();
    jest.spyOn(bookingsDataSource, 'getOtp').mockRejectedValue(new Error('offline'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    await render(newClient());
    await act(async () => {});
    expect(alert).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]![0]).toBe("Couldn't load your collection code");

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(alert).toHaveBeenCalledTimes(1);
  });
});
