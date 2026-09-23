import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCodes } from '@towing/api-contracts';
import { ApiClientError } from '@/lib/api/errors';
import { bookingsDataSource } from './bookingsDataSource';
import { paymentsDataSource } from '@/features/payments/api/paymentsDataSource';
import * as razorpay from '@/features/payments/razorpay';
import { CancellationFeeNotPaidError, useCancelBooking } from './bookings.queries';

// jest-expo stubs the native module, so its randomUUID returns undefined here.
jest.mock('expo-crypto', () => ({ randomUUID: () => 'idem-key-1' }));

/**
 * B15/B17: cancelling a trip that carries a fee.
 *
 * Before this, the app sent the cancel with nothing attached, the server
 * refused a chargeable tier with `cancellation_requires_payment`, and the
 * customer saw "Could not cancel" with no way to pay. The hook now collects the
 * fee through the same checkout the Payment screen uses, then cancels.
 */

const PAYMENT = { orderRef: 'order_1', gatewayRef: 'pay_1', signature: 'sig' };
const CANCELLED = {
  id: 'b1',
  status: 'cancelled' as const,
  tier: 'full' as const,
  feePaise: 99_900,
  driverCompensationPaise: 49_950,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function cancel(): Promise<{ value?: unknown; error?: unknown }> {
  const { result } = await renderHook(() => useCancelBooking(), { wrapper });
  let outcome: { value?: unknown; error?: unknown } = {};
  await act(async () => {
    try {
      outcome = { value: await result.current.mutateAsync({ bookingId: 'b1', reason: 'Too late' }) };
    } catch (error) {
      outcome = { error };
    }
  });
  return outcome;
}

describe('useCancelBooking', () => {
  afterEach(() => jest.restoreAllMocks());

  it('cancels a free trip in one call and never opens a payment', async () => {
    const cancelCall = jest
      .spyOn(bookingsDataSource, 'cancelBooking')
      .mockResolvedValue({ ...CANCELLED, tier: 'free', feePaise: 0, driverCompensationPaise: 0 });
    const intent = jest.spyOn(paymentsDataSource, 'createIntent');

    const outcome = await cancel();

    expect(outcome.error).toBeUndefined();
    expect(cancelCall).toHaveBeenCalledTimes(1);
    expect(cancelCall).toHaveBeenCalledWith('b1', 'Too late');
    expect(intent).not.toHaveBeenCalled();
  });

  it('pays the fee when the server asks for it, then cancels carrying the payment', async () => {
    const cancelCall = jest
      .spyOn(bookingsDataSource, 'cancelBooking')
      .mockRejectedValueOnce(
        new ApiClientError(409, ErrorCodes.CANCELLATION_REQUIRES_PAYMENT, 'Fee due', {
          tier: 'full',
          feePaise: 99_900,
        }),
      )
      .mockResolvedValueOnce(CANCELLED);
    const intent = jest
      .spyOn(paymentsDataSource, 'createIntent')
      .mockResolvedValue({ orderRef: 'order_1' } as never);
    const checkout = jest.spyOn(razorpay, 'openCheckout').mockResolvedValue(PAYMENT);

    const outcome = await cancel();

    expect(outcome.value).toEqual(CANCELLED);
    expect(intent).toHaveBeenCalledWith('b1', 'cancellation_fee', expect.any(String));
    expect(checkout).toHaveBeenCalledTimes(1);
    expect(cancelCall).toHaveBeenLastCalledWith('b1', 'Too late', PAYMENT);
  });

  it('treats a closed payment sheet as "not now", and does not cancel', async () => {
    const cancelCall = jest
      .spyOn(bookingsDataSource, 'cancelBooking')
      .mockRejectedValueOnce(
        new ApiClientError(409, ErrorCodes.CANCELLATION_REQUIRES_PAYMENT, 'Fee due'),
      );
    jest.spyOn(paymentsDataSource, 'createIntent').mockResolvedValue({} as never);
    jest.spyOn(razorpay, 'openCheckout').mockRejectedValue(new razorpay.CheckoutDismissedError());

    const outcome = await cancel();

    expect(outcome.error).toBeInstanceOf(CancellationFeeNotPaidError);
    expect(cancelCall).toHaveBeenCalledTimes(1);
  });

  it('passes any other refusal straight through', async () => {
    jest
      .spyOn(bookingsDataSource, 'cancelBooking')
      .mockRejectedValue(new ApiClientError(409, ErrorCodes.INVALID_BOOKING_STATE, 'Too late'));
    const intent = jest.spyOn(paymentsDataSource, 'createIntent');

    const outcome = await cancel();

    expect(outcome.error).toBeInstanceOf(ApiClientError);
    expect(intent).not.toHaveBeenCalled();
  });
});
