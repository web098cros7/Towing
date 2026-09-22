import { useQuery } from '@tanstack/react-query';
import type { AppConfig } from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import { env } from '@/lib/env';
import { SUPPORT_PHONE_DIAL, SUPPORT_PHONE_DISPLAY } from '@/screens/support/supportContact';

/**
 * The server's app-config: support contact, referral rewards, version gates and
 * the SEV banner. Public endpoint (`GET app-config`); a token does no harm.
 */
export interface AppConfigDataSource {
  get(): Promise<AppConfig>;
}

const MOCK_APP_CONFIG: AppConfig = {
  supportPhone: '+919876543210',
  supportEmail: 'support@mitow.in',
  referrerRewardPaise: 10000,
  refereeRewardPaise: 10000,
  minCustomerVersion: '1.0.0',
  minDriverVersion: '1.0.0',
  forceUpgrade: false,
  sevLevel: null,
  sevMessage: null,
  sevUpdatedAt: null,
};

const liveAppConfigDataSource: AppConfigDataSource = {
  get: () => apiFetch<AppConfig>('app-config'),
};

const mockAppConfigDataSource: AppConfigDataSource = {
  get: () => Promise.resolve(MOCK_APP_CONFIG),
};

export const appConfigDataSource: AppConfigDataSource = env.useMocks
  ? mockAppConfigDataSource
  : liveAppConfigDataSource;

/** The app-config, cached for an hour: it changes rarely and is not user-specific. */
export function useAppConfig() {
  return useQuery({
    queryKey: ['app-config'],
    queryFn: () => appConfigDataSource.get(),
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Formats an Indian support number for display.
 *  - '+91' + 10 digits → '+91 XXXXX XXXXX'
 *  - '+91' + '1800' toll-free (10 digits after +91 starting with 1800) → '+91 1800 XXX XXX'
 *  - anything else → unchanged
 */
function formatIndianPhone(raw: string): string {
  if (!raw.startsWith('+91')) return raw;
  const digits = raw.slice(3);
  if (digits.length !== 10) return raw;
  if (digits.startsWith('1800')) {
    return `+91 1800 ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/**
 * The support contact the app shows and dials. Live value comes from app-config;
 * before it loads (or if it fails) the offline fallbacks in `supportContact.ts`
 * are used.
 */
export function useSupportContact(): {
  phoneDial: string;
  phoneDisplay: string;
  email: string;
} {
  const { data } = useAppConfig();
  const phoneDial = data?.supportPhone ?? SUPPORT_PHONE_DIAL;
  const phoneDisplay = data?.supportPhone
    ? formatIndianPhone(data.supportPhone)
    : SUPPORT_PHONE_DISPLAY;
  const email = data?.supportEmail ?? 'support@mitow.in';
  return { phoneDial, phoneDisplay, email };
}
