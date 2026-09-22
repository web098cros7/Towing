import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { InviteView } from '@/features/invite/InviteView';

/**
 * Refer & Earn's public invite page — `https://mitow.in/r/{code}`.
 *
 * THE SECOND UNAUTHENTICATED PAGE IN THIS APP, and it lives here for the same
 * reason `/t/{token}` does: a second Next app would duplicate the shell, the
 * build and the deploy for one route. `middleware.ts` is deny-by-default, so
 * `/r/` is added to `PUBLIC_PREFIXES` there — without that branch this page
 * redirects to `/login` and a friend forwarded a code is asked for a fleet
 * password.
 *
 * NOINDEX. The code is a bearer-ish token for a reward; a crawler that indexed
 * one would hand it to strangers. Robots directives are not a security control
 * — the code is short and guessable by design — but this closes the accidental
 * path, exactly as the share-trip page does.
 */

export const metadata: Metadata = {
  title: "You're invited to MiTow",
  robots: { index: false, follow: false },
};

const CODE_PATTERN = /^[A-Za-z0-9]{4,20}$/;
const DEFAULT_REFEREE_REWARD_PAISE = 10000;

/**
 * The reward is read from the public app-config so the copy on this page and
 * the amount the wallet actually credits cannot drift. Cached for an hour: the
 * value changes when an admin edits it, not per request, and this page is
 * forwarded through group chats.
 *
 * ON ANY FAILURE the fallback is the same 10000 paise the backend uses when
 * `app_config` is empty — a wrong number on a marketing page is worse than a
 * stale one, and an unreachable API must not blank the invite.
 */
async function fetchRefereeRewardPaise(): Promise<number> {
  try {
    const response = await fetch(`${env.apiBaseUrl}/v1/app-config`, {
      headers: { accept: 'application/json' },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return DEFAULT_REFEREE_REWARD_PAISE;
    const body = (await response.json()) as { refereeRewardPaise?: unknown };
    const value = body?.refereeRewardPaise;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    return DEFAULT_REFEREE_REWARD_PAISE;
  } catch {
    return DEFAULT_REFEREE_REWARD_PAISE;
  }
}

export default async function PublicInvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const valid = CODE_PATTERN.test(code);

  if (!valid) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-[#F3F6F8] p-8 text-center">
        <img src="/brand/logo.svg" alt="MiTow" width={120} height={32} />
        <p className="text-sm text-[#4A5568]">This invite link isn&apos;t valid.</p>
      </main>
    );
  }

  const rewardPaise = await fetchRefereeRewardPaise();

  return <InviteView code={code.toUpperCase()} rewardPaise={rewardPaise} />;
}
