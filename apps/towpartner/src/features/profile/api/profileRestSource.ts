import type { DriverProfile as DriverMe } from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { ProfileDataSource } from './profileDataSource';
import type { DriverProfile } from '../types';

/**
 * The driver's own profile against the real server.
 *
 * `driver/me` is the single source for both the profile screen's view model
 * and the raw contract (Personal Information reads the raw one directly).
 */
export const profileRestSource: ProfileDataSource = {
  async getProfile(): Promise<DriverProfile> {
    const me = await apiFetch<DriverMe>('driver/me');
    return toProfile(me);
  },

  async getMe(): Promise<DriverMe> {
    return apiFetch<DriverMe>('driver/me');
  },
};

function toProfile(me: DriverMe): DriverProfile {
  return {
    name: me.name ?? 'Partner',
    // A readable reference for the driver to quote to support — derived from
    // the server id, not a secret and not a credential.
    driverId: `DRV-${me.id.slice(0, 6).toUpperCase()}`,
    verified: me.kycStatus === 'approved',
    phone: me.mobile,
    // The driver record has no email in this app.
    email: null,
    avatar: me.photoUrl,
    stats: {
      jobsCompleted: me.totalTrips,
      rating: me.rating,
      experienceLabel: experienceLabel(me.memberSince),
      completionPercent:
        me.completionRatePct === null ? null : Math.round(me.completionRatePct),
    },
  };
}

/**
 * "New" under 30 days, months under a year, years to one decimal after that.
 * The thresholds are calendar-ish (30-day months, 365-day years) because the
 * label is a human summary, not a billing figure.
 */
function experienceLabel(memberSince: string): string {
  const started = new Date(memberSince).getTime();
  if (Number.isNaN(started)) return 'New';
  const days = Math.floor((Date.now() - started) / 86_400_000);
  if (days < 30) return 'New';
  if (days < 365) return `${Math.floor(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} yrs`;
}
