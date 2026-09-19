/**
 * Dial codes the 03 Login country-code group (`259:1762`) can select.
 *
 * Figma draws the code text `259:1763` as the selected dial code, with "+91" as
 * the example, and the down chevron as a picker affordance. No picker and no
 * country list are drawn (spec data gap 2), and the auth backend validates
 * Indian numbers only, so India is the only entry until both exist. Add a row
 * here once the backend accepts another country.
 */
export type LoginDialCode = {
  /** ISO 3166-1 alpha-2. */
  iso: string;
  country: string;
  /** With the leading "+", exactly as the code text shows it. */
  dialCode: string;
  /** Digits in a national mobile number; caps what the field accepts. */
  nationalNumberLength: number;
};

const INDIA: LoginDialCode = {
  iso: 'IN',
  country: 'India',
  dialCode: '+91',
  nationalNumberLength: 10,
};

export const LOGIN_DIAL_CODES: readonly LoginDialCode[] = [INDIA];

export const DEFAULT_LOGIN_DIAL_CODE: LoginDialCode = INDIA;
