import { env } from '@/lib/env';
import { SUPPORT_PHONE_DISPLAY } from './supportContact';

/**
 * Mock-mode value for 58 · Support's "Call Support" subtitle.
 *
 * Figma draws the sample "+91 98765 43210" (Menu Row subtitle on card `254:1244`:
 * +91, a space, 5 digits, a space, 5 digits). No backend or contract field carries
 * a support number, so the designed value lives here as MOCK data: with
 * EXPO_PUBLIC_USE_MOCKS=true the row renders exactly as drawn. Against the real
 * backend it shows the app's existing support line (`supportContact.ts`) until
 * Ehsan confirms the real number.
 *
 * Display only: nothing dials this. The Call Support card routes to `ContactUs`.
 */
export const SUPPORT_MOCK_PHONE_DISPLAY = '+91 98765 43210';

export const supportPhoneDisplay: string = env.useMocks
  ? SUPPORT_MOCK_PHONE_DISPLAY
  : SUPPORT_PHONE_DISPLAY;
