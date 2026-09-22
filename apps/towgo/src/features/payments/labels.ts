import type { PaymentMethodKind } from './types';

/**
 * 27's Payment Method Row titles, VERBATIM (Title#238:9 on `239:724`, `239:736`, `239:747`,
 * `239:757`). "Credit / Debit Card" has U+0020 spaces around the U+002F slash. 29's "Payment
 * method" row and 30's "Payment Method" row show the same label, so the three screens agree.
 * (30 draws only "UPI"; the other three are 27's copy.)
 */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethodKind, string> = {
  upi: 'UPI',
  card: 'Credit / Debit Card',
  wallet: 'Wallet',
  cash: 'Cash',
};
