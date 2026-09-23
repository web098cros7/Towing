import { Alert } from 'react-native';

export type PaymentNotice = 'not_started' | 'confirming';

/**
 * P19: the two payment states Figma has no screen for. A system alert is how this app shows a
 * state the design lacks, so nothing here draws an invented screen.
 *
 * The wording keeps to what is actually known. `not_started` never reached the bank, so it can
 * say nothing was charged. `confirming` cannot say that: the bank may already have taken the
 * money, so it asks the customer not to pay again, because paying twice is the real risk there.
 */
export function paymentNoticeCopy(notice: PaymentNotice): { title: string; message: string } {
  switch (notice) {
    case 'not_started':
      return {
        title: "Payment couldn't start",
        message: 'Nothing was charged. Check your connection and try again.',
      };
    case 'confirming':
      return {
        title: 'Your bank is still confirming',
        message:
          "Please don't pay again yet. If the money has left your account, this trip will show as paid once your bank confirms.",
      };
  }
}

export function showPaymentNotice(notice: PaymentNotice, onCheckAgain: () => void): void {
  const { title, message } = paymentNoticeCopy(notice);
  if (notice === 'confirming') {
    Alert.alert(title, message, [
      { text: 'OK', style: 'cancel' },
      { text: 'Check again', onPress: onCheckAgain },
    ]);
    return;
  }
  Alert.alert(title, message);
}
