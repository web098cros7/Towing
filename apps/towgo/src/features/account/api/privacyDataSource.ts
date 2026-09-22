import type {
  AccountDeletionResponse,
  AccountExportResponse,
  ConsentPolicyType,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import { privacyMockSource } from './privacyMockSource';
import { privacyRestSource } from './privacyRestSource';

/** §20.4 DPDP — consent capture, account deletion, data export (dual-realm on the backend, customer-only here). */
export interface PrivacyDataSource {
  deleteAccount(reason?: string): Promise<AccountDeletionResponse>;
  exportData(): Promise<AccountExportResponse>;
  recordConsent(policyType: ConsentPolicyType, policyVersion: string): Promise<void>;
  /**
   * Stops marketing messages; the account carries on working. Deleting the
   * account is `deleteAccount`, deliberately a separate thing.
   */
  withdrawConsent(policyType: ConsentPolicyType): Promise<void>;
}

export const privacyDataSource: PrivacyDataSource = env.useMocks ? privacyMockSource : privacyRestSource;
