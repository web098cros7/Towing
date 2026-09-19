/**
 * Display format drawn on 04 Verify OTP: "+91 98765 43210" (country code, a
 * space, 5 digits, a space, 5 digits; plain U+0020 spaces).
 *
 * LoginScreen hands this screen the unformatted `+91XXXXXXXXXX`. Anything that
 * does not look like a 10-digit Indian mobile is returned unchanged rather than
 * mangled.
 */
export function formatIndianMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  const national =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 10
        ? digits
        : null;
  if (!national) return mobile;
  return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
}
