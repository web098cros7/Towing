import type {
  AccountDeletionResponse,
  AccountExportResponse,
  ConsentStatus,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { PrivacyDataSource } from './privacyDataSource';

export const privacyRestSource: PrivacyDataSource = {
  deleteAccount(reason) {
    return apiFetch<AccountDeletionResponse>('me', {
      method: 'DELETE',
      body: JSON.stringify(reason ? { reason } : {}),
      idempotent: true,
    });
  },

  exportData() {
    return apiFetch<AccountExportResponse>('me/export');
  },

  consentStatus() {
    return apiFetch<ConsentStatus>('me/consent');
  },

  async recordConsent(policyType, policyVersion) {
    await apiFetch<void>('me/consent', {
      method: 'POST',
      body: JSON.stringify({ policyType, policyVersion }),
      idempotent: true,
    });
  },

  async withdrawConsent(policyType) {
    await apiFetch<void>('me/consent/withdraw', {
      method: 'POST',
      body: JSON.stringify({ policyType }),
      idempotent: true,
    });
  },
};
