import { hasAgreedTo } from './privacy.queries';

const granted = (policyType: 'privacy_policy' | 'terms_of_service', policyVersion: string) => ({
  policyType,
  policyVersion,
  action: 'granted' as const,
  consentedAt: '2026-09-24T10:00:00.000Z',
});

describe('hasAgreedTo: the one-time consent, per account', () => {
  it('needs both policies at the current version', () => {
    expect(
      hasAgreedTo(
        { granted: [granted('privacy_policy', 'v2'), granted('terms_of_service', 'v2')] },
        'v2',
      ),
    ).toBe(true);
  });

  it('asks again when only one policy was agreed to', () => {
    expect(hasAgreedTo({ granted: [granted('privacy_policy', 'v2')] }, 'v2')).toBe(false);
  });

  it('asks again after a policy version bump', () => {
    expect(
      hasAgreedTo(
        { granted: [granted('privacy_policy', 'v1'), granted('terms_of_service', 'v1')] },
        'v2',
      ),
    ).toBe(false);
  });

  it('asks an account that has agreed to nothing', () => {
    expect(hasAgreedTo({ granted: [] }, 'v2')).toBe(false);
  });
});
