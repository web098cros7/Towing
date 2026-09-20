import type { SupportTicketCategory } from '@towing/api-contracts';

/**
 * The requester-facing labels for §9.4.12's categories — the same six values
 * the console filters by, in the requester's vocabulary ("App" not "app").
 */
export const SUPPORT_CATEGORIES: readonly { value: SupportTicketCategory; label: string }[] = [
  { value: 'booking', label: 'Booking' },
  { value: 'payment', label: 'Payment' },
  { value: 'kyc', label: 'KYC / documents' },
  { value: 'app', label: 'App problem' },
  { value: 'safety', label: 'Safety' },
  { value: 'other', label: 'Something else' },
];
