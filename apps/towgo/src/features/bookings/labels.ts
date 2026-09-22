import type { BookingPaymentMethod } from './types';

/** How the trip was paid for, as shown on the details screen. */
export const PAYMENT_LABEL: Record<BookingPaymentMethod, string> = {
  card: 'Card',
  upi: 'UPI',
  wallet: 'Wallet',
  cash: 'Cash',
};
