import { randomUUID } from 'expo-crypto';
import type {
  AccountDeletionResponse,
  AccountExportResponse,
  ConsentRecord,
  ConsentStatus,
} from '@towing/api-contracts';
import type { PrivacyDataSource } from './privacyDataSource';
import { profileMockSource } from './profileMockSource';
import { vehiclesMockSource } from './vehiclesMockSource';
import { addressesMockSource } from './addressesMockSource';
import { emergencyContactsMockSource } from './emergencyContactsMockSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const consents: ConsentRecord[] = [];

export const privacyMockSource: PrivacyDataSource = {
  async deleteAccount(_reason): Promise<AccountDeletionResponse> {
    await delay(500);
    return { requestId: randomUUID(), status: 'requested', requestedAt: new Date().toISOString() };
  },

  async exportData(): Promise<AccountExportResponse> {
    await delay(600);
    const [profile, vehicles, addresses, emergencyContacts] = await Promise.all([
      profileMockSource.getProfile(),
      vehiclesMockSource.list(),
      addressesMockSource.list(),
      emergencyContactsMockSource.list(),
    ]);
    return { profile, vehicles, addresses, emergencyContacts, consents };
  },

  /** The newest agreement per policy, as the server answers; withdrawals do not remove one. */
  async consentStatus(): Promise<ConsentStatus> {
    await delay(200);
    const latest = new Map<string, ConsentRecord>();
    for (const record of consents) {
      if (record.action === 'granted') latest.set(record.policyType, record);
    }
    return { granted: [...latest.values()] };
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

  /**
   * Appends a withdrawal rather than removing the agreement, exactly as the
   * server does — the export shows the whole history, not the latest state.
   */
  async withdrawConsent(policyType) {
    await delay(300);
    const latest = [...consents].reverse().find((c) => c.policyType === policyType);
    consents.push({
      policyType,
      policyVersion: latest?.policyVersion ?? 'unknown',
      action: 'withdrawn',
      consentedAt: new Date().toISOString(),
    });
  },
};
