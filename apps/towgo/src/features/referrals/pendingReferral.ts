import { useEffect } from 'react';
import { Linking } from 'react-native';
import { storage } from '@/lib/storage/storage';
import { useApplyReferral } from './api/referrals';

const PENDING_KEY = 'referral.pendingCode';

const CODE_PATTERN = /^[A-Za-z0-9]{4,20}$/;

/**
 * Parses a referral code out of an invite link. Accepts:
 *   - moveyo://r/CODE
 *   - moveyo:///r/CODE
 *   - https://mitow.in/r/CODE
 *   - https://www.mitow.in/r/CODE
 * Returns the code uppercased, or null when the URL is not a referral link.
 */
export function parseReferralCode(url: string): string | null {
  if (!url) return null;
  let path: string | null = null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isCustomScheme = parsed.protocol === 'moveyo:';
    const isWebHost = host === 'mitow.in' || host === 'www.mitow.in';
    if (!isCustomScheme && !isWebHost) return null;
    path = parsed.pathname;
  } catch {
    return null;
  }
  if (!path) return null;
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length !== 2) return null;
  if (segments[0].toLowerCase() !== 'r') return null;
  const code = segments[1];
  if (!CODE_PATTERN.test(code)) return null;
  return code.toUpperCase();
}

export function storePendingReferral(code: string): void {
  storage.set(PENDING_KEY, code);
}

export function takePendingReferral(): string | null {
  const code = storage.getString(PENDING_KEY);
  if (code === undefined) return null;
  storage.delete(PENDING_KEY);
  return code;
}

/**
 * Captures referral codes from deep links. Mount once at the navigator root.
 * Reads the initial URL (cold start) and subscribes to subsequent URLs (warm
 * start). Any parsed code is stored for later application.
 */
export function useCaptureReferralLinks(): void {
  useEffect(() => {
    let cancelled = false;

    Linking.getInitialURL()
      .then((url) => {
        if (cancelled || !url) return;
        const code = parseReferralCode(url);
        if (code) storePendingReferral(code);
      })
      .catch(() => {});

    const subscription = Linking.addEventListener('url', ({ url }) => {
      const code = parseReferralCode(url);
      if (code) storePendingReferral(code);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
}

/**
 * Applies a stored pending referral code once the caller is ready (signed in
 * and past profile setup). On 422/409 the code is dropped silently — it is
 * invalid, the user's own, or already used. On a network failure the code is
 * stored back so the next launch can retry.
 */
export function useApplyPendingReferral(enabled: boolean): void {
  const applyReferral = useApplyReferral();

  useEffect(() => {
    if (!enabled) return;
    const code = takePendingReferral();
    if (!code) return;
    applyReferral.mutate(code, {
      onError: (error: unknown) => {
        const status = extractStatus(error);
        if (status === 422 || status === 409) return;
        storePendingReferral(code);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

function extractStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const maybe = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof maybe.status === 'number') return maybe.status;
  if (maybe.response && typeof maybe.response.status === 'number') {
    return maybe.response.status;
  }
  return undefined;
}
