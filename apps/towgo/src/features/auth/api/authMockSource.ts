import type { CustomerSession } from '@towing/api-contracts';
import { ApiClientError } from '@/lib/api/errors';
import type { AuthDataSource } from './authDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Fixed challenge id + code — the "hermetic Maestro flow" the B0 canonical block requires with no backend at all. */
export const MOCK_CHALLENGE_ID = '00000000-0000-4000-8000-000000000099';
/**
 * TEMPORARY — six zeros, not the old `123456`, so the flow can be walked without
 * a real SMS provider. Six because the OTP screen has six boxes and auto-submits
 * on the sixth digit; a five-digit code would never submit itself.
 */
export const MOCK_OTP = '000000';

let mockMobile = '';

export const authMockSource: AuthDataSource = {
  async sendOtp(mobile) {
    await delay(400);
    mockMobile = mobile;
    return {
      challengeId: MOCK_CHALLENGE_ID,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      resendAfterSeconds: 30,
    };
  },

  async verifyOtp(challengeId, otp): Promise<CustomerSession> {
    await delay(400);
    if (challengeId !== MOCK_CHALLENGE_ID || otp !== MOCK_OTP) {
      throw new ApiClientError(401, 'unauthorized', 'That code was not accepted.');
    }
    return {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      // TEMPORARY `isNew: true` — the redesigned Profile Setup screen only mounts
      // for a new customer, so with `false` it is unreachable and cannot be
      // reviewed. Submitting the name flips it to false, which then lets the
      // consent gate open, so one mock login walks the whole 01–06 flow.
      customer: { id: 'mock-customer-1', mobile: mockMobile, name: '', isNew: true },
    };
  },

  async logout() {
    await delay(200);
  },
};
