'use client';

import { Skeleton } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import {
  useAdminAppConfig,
  useAdminDispatchConfig,
} from '@/features/admin-dispatch/api/adminDispatch.queries';
import { AppConfigPanel } from '@/features/admin-dispatch/components/AppConfigPanel';
import { DispatchGlobalForm } from '@/features/admin-dispatch/components/DispatchGlobalForm';
import { KillSwitchPanel } from '@/features/admin-dispatch/components/KillSwitchPanel';
import { ZoneLadderTable } from '@/features/admin-dispatch/components/ZoneLadderTable';

/**
 * `/admin/dispatch` — W12's §6.7 / §19.8 / §19.9 screen.
 *
 * FOUR PANELS, ONE QUESTION EACH: how does the marketplace rank and pace itself
 * (weights, liveness, cadence), where does it operate and how far does it reach
 * (per-zone ladders), what would stop it (the kill switches), and what do the
 * apps tell everyone right now (versions + the SEV banner).
 *
 * `dispatch.config` — super admin and operations, the same pair that owns the
 * kill switches, because the banner and the switches get pulled in the same
 * incident by the same person.
 */
export default function AdminDispatchPage() {
  const can = useAdminCan();
  const enabled = can('dispatch.config');
  const config = useAdminDispatchConfig();
  const appConfig = useAdminAppConfig();

  if (!enabled) {
    return (
      <div>
        <PageHeader
          title="Dispatch"
          description="Weights, ladders, kill switches and the app-wide status banner."
        />
        <AdminForbidden resource="the dispatch configuration" />
      </div>
    );
  }

  const loading = config.isLoading || appConfig.isLoading || !config.data || !appConfig.data;

  return (
    <div>
      <PageHeader
        title="Dispatch"
        description="Weights, ladders, kill switches and the app-wide status banner."
      />

      {config.isError || appConfig.isError ? (
        <p className="text-sm text-error">Could not load the dispatch configuration.</p>
      ) : loading ? (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="space-y-5">
          <DispatchGlobalForm config={config.data} />
          <ZoneLadderTable config={config.data} />
          <KillSwitchPanel config={config.data} />
          <AppConfigPanel config={appConfig.data} />
        </div>
      )}
    </div>
  );
}
