'use client';

import Link from 'next/link';
import { Button, ErrorState, Skeleton, buttonVariants, cn } from '@towing/web-ui';
import {
  useAdvanceOnboarding,
  useFleetSettings,
} from '@/features/settings/api/settings.queries';
import { BusinessProfileForm } from '@/features/settings/components/BusinessProfileForm';
import { NotificationPrefsCard } from '@/features/settings/components/NotificationPrefsCard';
import { PayoutAccountCard } from '@/features/settings/components/PayoutAccountCard';
import { ONBOARDING_STEP_LABELS, type OnboardingStep } from '@/features/settings/types';

const STEPS: OnboardingStep[] = ['profile', 'payout_account', 'notifications'];

/**
 * §9.3.1's resumable first-login wizard.
 *
 * Resumable **across devices and sessions**, not merely across page reloads:
 * the current step is `fleets.onboarding_step` on the server, read on mount.
 * localStorage would only survive a refresh on the same browser.
 *
 * The three panels are the SAME components `/settings` renders. That is what
 * makes "editable later from Settings" free, and it is why the wizard cannot
 * drift from the screen it hands off to.
 */
export default function OnboardingPage() {
  const { data, isLoading, isError, refetch } = useFleetSettings();
  const advance = useAdvanceOnboarding();

  if (isError) {
    return <ErrorState onRetry={() => void refetch()} />;
  }

  if (isLoading || !data) {
    return <Skeleton className="h-96" />;
  }

  const step = data.onboarding.step;

  if (step === 'done') {
    return (
      <div className="rounded-card border border-border bg-card p-8 text-center">
        <h1 className="text-lg font-semibold">You&rsquo;re all set</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Your account is fully configured. You can change any of this from Settings at any time.
        </p>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: 'primary', size: 'md' }), 'mt-6 inline-flex')}
        >
          Go to the dashboard
        </Link>
      </div>
    );
  }

  const index = STEPS.indexOf(step);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Set up your fleet</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Step {index + 1} of {STEPS.length} — {ONBOARDING_STEP_LABELS[step]}
        </p>
        <ol className="mt-4 flex gap-2" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={s === step ? 'step' : undefined}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                i <= index ? 'bg-brand' : 'bg-border-strong',
              )}
            />
          ))}
        </ol>
      </div>

      {step === 'profile' ? (
        <>
          <BusinessProfileForm settings={data} submitLabel="Save and continue" />
          <div className="flex justify-end">
            <Button
              onClick={() => advance.mutate('profile')}
              disabled={!data.onboarding.profileComplete || advance.isPending}
              title={
                data.onboarding.profileComplete
                  ? undefined
                  : 'Save your business name and address first'
              }
            >
              Continue
            </Button>
          </div>
        </>
      ) : null}

      {step === 'payout_account' ? (
        <>
          <PayoutAccountCard settings={data} />
          <div className="flex items-center justify-between">
            {/*
              §9.3.1 gates the account on the business profile, not on the bank
              details, so this step is genuinely skippable — the payout button
              simply stays disabled until an account is linked.
            */}
            <Button variant="ghost" onClick={() => advance.mutate('payout_account')}>
              Skip for now
            </Button>
            <Button
              onClick={() => advance.mutate('payout_account')}
              disabled={!data.onboarding.payoutAccountLinked || advance.isPending}
            >
              Continue
            </Button>
          </div>
        </>
      ) : null}

      {step === 'notifications' ? (
        <>
          <NotificationPrefsCard settings={data} submitLabel="Save preferences" />
          <div className="flex justify-end">
            <Button onClick={() => advance.mutate('notifications')} disabled={advance.isPending}>
              Finish setup
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
