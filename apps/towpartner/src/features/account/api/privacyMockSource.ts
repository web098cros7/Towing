import { randomUUID } from 'expo-crypto';
import type { AccountDeletionResponse, AccountExportResponse, ConsentRecord } from '@towing/api-contracts';
import { profileMockSource } from '@/features/profile/api/profileMockSource';
import type { PrivacyDataSource } from './privacyDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const consents: ConsentRecord[] = [];

export const privacyMockSource: PrivacyDataSource = {
  async deleteAccount(_reason): Promise<AccountDeletionResponse> {
    await delay(500);
    return { requestId: randomUUID(), status: 'requested', requestedAt: new Date().toISOString() };
  },

  async exportData(): Promise<AccountExportResponse> {
    await delay(600);
    // No vehicles/addresses/emergencyContacts keys at all, not empty arrays —
    // those are customer-only tables and the backend's driver export omits
    // them, which is how a client tells "not my realm" from "mine and empty".
    const profile = await profileMockSource.getProfile();
    return { profile, consents };
  },

  async recordConsent(policyType, policyVersion) {
    await delay(300);
    consents.push({
      policyType,
      policyVersion,
      action: 'granted',
      consentedAt: new Date().toISOString(),
    });
  },
};
