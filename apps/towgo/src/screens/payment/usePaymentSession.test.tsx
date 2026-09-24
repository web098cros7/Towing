import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCodes } from '@towing/api-contracts';
import { ApiClientError } from '@/lib/api/errors';
import { bookingsDataSource } from '@/features/bookings/api/bookingsDataSource';
import { paymentsDataSource } from '@/features/payments/api/paymentsDataSource';
import * as razorpay from '@/features/payments/razorpay';
import { paymentNoticeCopy } from './paymentNotice';
import { usePaymentSession, type PaymentOutcome } from './usePaymentSession';

// jest-expo stubs the native module, so its randomUUID returns undefined here.
jest.mock('expo-crypto', () => ({ randomUUID: () => 'idem-key-1' }));

/**
 * P19: the two payment states Figma has no screen for. Before this, both returned a bare
 * `stay` and the customer was left on 27 with nothing shown, including when the bank might
 * already have taken the money.
 */

const INTENT = { orderRef: 'order_1', amountPaise: 99_900, walletOnly: false, walletAppliedPaise: 0 };
const CHECKOUT = { orderRef: 'order_1', gatewayRef: 'pay_1', signature: 'sig' };

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function session() {
  jest.spyOn(paymentsDataSource, 'createIntent').mockResolvedValue(INTENT as never);
  const { result } = await renderHook(() => usePaymentSession('b1'), { wrapper });
  await waitFor(() => expect(result.current.intent).not.toBeNull());
  return result;
}

async function run(fn: () => Promise<PaymentOutcome>): Promise<PaymentOutcome> {
  let outcome: PaymentOutcome = { kind: 'stay' };
  await act(async () => {
    outcome = await fn();
  });
  return outcome;
}

describe('usePaymentSession: the states with no Figma screen (P19)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('says so when the checkout could not start, and nothing was charged', async () => {
    const result = await session();
    jest.spyOn(razorpay, 'openCheckout').mockRejectedValue(new Error('native module missing'));
    const capture = jest.spyOn(paymentsDataSource, 'capture');

    const outcome = await run(() => result.current.pay('upi'));

    expect(outcome).toEqual({ kind: 'stay', notice: 'not_started' });
    expect(capture).not.toHaveBeenCalled();
  });

  it('stays silent when the customer closed the checkout themselves', async () => {
    const result = await session();
    jest.spyOn(razorpay, 'openCheckout').mockRejectedValue(new razorpay.CheckoutDismissedError());

    expect(await run(() => result.current.pay('upi'))).toEqual({ kind: 'stay' });
  });

  it('says the bank is confirming, and Check again goes to 30 once the booking is paid', async () => {
    const result = await session();
    jest.spyOn(razorpay, 'openCheckout').mockResolvedValue(CHECKOUT);
    jest.spyOn(paymentsDataSource, 'capture').mockRejectedValue(
      new ApiClientError(422, ErrorCodes.PAYMENT_NOT_CAPTURED, 'Not captured', {
        gatewayStatus: 'pending',
      }),
    );
    const read = jest
      .spyOn(bookingsDataSource, 'getBooking')
      .mockResolvedValueOnce({ id: 'b1', status: 'completed' } as never)
      .mockResolvedValueOnce({ id: 'b1', status: 'paid' } as never);

    expect(await run(() => result.current.pay('upi'))).toEqual({
      kind: 'stay',
      notice: 'confirming',
    });

    const later = await run(() => result.current.recheck());
    expect(later).toMatchObject({ kind: 'paid', transactionId: 'pay_1', amountPaise: 99_900 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never tells a customer whose money may have left that nothing was charged', () => {
    expect(paymentNoticeCopy('confirming').message).not.toMatch(/nothing was charged/i);
    expect(paymentNoticeCopy('confirming').message).toMatch(/don't pay again/i);
    expect(paymentNoticeCopy('not_started').message).toMatch(/nothing was charged/i);
  });
});

describe('usePaymentSession: 30 shows what the server recorded (P28/P29)', () => {
  afterEach(() => jest.restoreAllMocks());

  it("takes the paid time and method from the booking, not the phone's clock or 27's pick", async () => {
    const result = await session();
    jest.spyOn(razorpay, 'openCheckout').mockResolvedValue(CHECKOUT);
    jest.spyOn(paymentsDataSource, 'capture').mockResolvedValue({
      status: 'captured',
      amountPaise: 99_900,
    } as never);
    jest.spyOn(bookingsDataSource, 'getBooking').mockResolvedValue({
      id: 'b1',
      status: 'paid',
      paidAt: '2026-09-24T10:15:00.000Z',
      paymentMethod: 'card',
    } as never);

    expect(await run(() => result.current.pay('upi'))).toEqual({
      kind: 'paid',
      method: 'card',
      transactionId: 'pay_1',
      paidAt: '2026-09-24T10:15:00.000Z',
      amountPaise: 99_900,
    });
  });

  it('still reaches 30 when the booking cannot be read after a capture', async () => {
    const result = await session();
    jest.spyOn(razorpay, 'openCheckout').mockResolvedValue(CHECKOUT);
    jest.spyOn(paymentsDataSource, 'capture').mockResolvedValue({
      status: 'captured',
      amountPaise: 99_900,
    } as never);
    jest.spyOn(bookingsDataSource, 'getBooking').mockRejectedValue(new Error('offline'));

    const outcome = await run(() => result.current.pay('upi'));
    expect(outcome).toMatchObject({ kind: 'paid', method: 'upi', amountPaise: 99_900 });
    expect(outcome.kind === 'paid' && Number.isNaN(Date.parse(outcome.paidAt))).toBe(false);
  });
});
