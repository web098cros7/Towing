import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { navigationRef } from '@/navigation/navigationRef';
import { useCurrentJob } from '@/features/offers/api/offers.queries';
import type { RootStackParamList } from '@/navigation/types';

/**
 * A driver who restarts the app mid-job lands back on it.
 *
 * THE JOB SURVIVES THE RESTART ON THE SERVER — `driver/jobs/current` returns it
 * — but nothing on the client ever navigated to it. The app opened on the home
 * screen, the driver saw the online toggle and the dashboard, and the job they
 * were halfway through was invisible unless they happened to remember it and
 * find the banner. That is the wrong default: a driver who was on a job when
 * the app died was still on that job when it came back.
 *
 * ONCE PER APP LAUNCH, not once per mount. The home screen remounts on every
 * tab switch, and re-navigating each time would yank the driver out of whatever
 * they were doing. A module-level flag is the right scope: it is per-process,
 * which is exactly "per app launch".
 *
 * `enabled` gates on approval + KYC so a driver who is not yet allowed to work
 * is not navigated into a job screen they cannot act on.
 */
let resumed = false;

const ACTIVE_STATUSES = new Set(['assigned', 'en_route', 'arrived', 'in_progress']);

export function useResumeActiveJob(enabled: boolean): void {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: job } = useCurrentJob();

  useEffect(() => {
    if (resumed) return;
    if (!enabled) return;
    // `undefined` = the first read has not landed yet. Once it has, this
    // launch's decision is made either way: a driver who accepts a job later
    // and backs out to Home must not be bounced onto it again.
    if (job === undefined) return;
    resumed = true;
    if (!job || !ACTIVE_STATUSES.has(job.status)) return;

    // `navigationRef` is preferred when it is ready — it is the same ref the
    // offer gate uses, and it survives the home screen unmounting between the
    // effect firing and the navigation landing. `useNavigation` is the
    // fallback for the (unlikely) case where the container has not mounted yet.
    if (navigationRef.isReady()) {
      navigationRef.navigate('AssignedJob');
      return;
    }
    navigation.navigate('AssignedJob');
  }, [enabled, job, navigation]);
}
