'use client';

import Link from 'next/link';
import { Card, CardContent, ErrorState, Skeleton, buttonVariants, cn } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useFleetSettings } from '@/features/settings/api/settings.queries';
import { BusinessProfileForm } from '@/features/settings/components/BusinessProfileForm';
import { NotificationPrefsCard } from '@/features/settings/components/NotificationPrefsCard';
import { PayoutAccountCard } from '@/features/settings/components/PayoutAccountCard';

export default function SettingsPage() {
  const { data, isLoading, isError, refetch } = useFleetSettings();

  if (isError) {
    return (
      <div>
        <PageHeader title="Settings" />
        <ErrorState onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Business profile, payout bank account and notification preferences."
      />

      {/*
        §9.3.1's wizard is reachable from here rather than forced by a redirect:
        the profile gate is scoped to the money paths, so an unfinished account
        can still run its fleet. This is the nudge, not a wall.
      */}
      {data && data.onboarding.step !== 'done' ? (
        <Card className="mb-6 border-warning-soft-bg bg-warning-soft-bg/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="text-sm font-semibold">Finish setting up your account</p>
              <p className="text-xs text-text-secondary">
                {data.onboarding.profileComplete
                  ? 'Link a bank account so you can withdraw your earnings.'
                  : 'Complete your business profile to request payouts.'}
              </p>
            </div>
            <Link href="/onboarding" className={cn(buttonVariants({ variant: 'primary', size: 'md' }))}>
              Continue setup
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        {isLoading || !data ? (
          <>
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </>
        ) : (
          <>
            <BusinessProfileForm settings={data} />
            <PayoutAccountCard settings={data} />
            <NotificationPrefsCard settings={data} />
          </>
        )}
      </div>
    </div>
  );
}
