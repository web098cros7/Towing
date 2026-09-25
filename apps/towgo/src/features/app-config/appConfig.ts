import { useQuery } from '@tanstack/react-query';
import type { AppConfig } from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import { env } from '@/lib/env';

/**
 * The server's app-config: support contact, referral rewards, version gates and
 * the SEV banner. Public endpoint (`GET app-config`); a token does no harm.
 */
export interface AppConfigDataSource {
  get(): Promise<AppConfig>;
}

const MOCK_APP_CONFIG: AppConfig = {
  supportPhone: '+911800123456',
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
 * Numbers that are placeholders, not a line anyone answers: the server's
 * default until the real support number is set, and Figma's sample. The app
 * never shows or dials them (owner, 25 Sep 2026).
 */
const PLACEHOLDER_SUPPORT_PHONES = new Set(['+911800123456', '+919876543210']);

/**
 * The support contact the app shows and dials, from app-config. `phoneDial` and
 * `phoneDisplay` are null until the config has loaded a REAL number: every call
 * button is then hidden or routed to Contact Us instead of dialling a made-up line.
 */
export function useSupportContact(): {
  phoneDial: string | null;
  phoneDisplay: string | null;
  email: string;
} {
  const { data } = useAppConfig();
  const phone = data?.supportPhone?.trim();
  const real = phone && !PLACEHOLDER_SUPPORT_PHONES.has(phone) ? phone : null;
  const email = data?.supportEmail ?? 'support@mitow.in';
  return { phoneDial: real, phoneDisplay: real ? formatIndianPhone(real) : null, email };
}
