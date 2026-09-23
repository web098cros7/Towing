import type { JobEarnings } from '@towing/api-contracts';
import { formatPaise } from '@/utils/format';

/**
 * What THIS driver gets for a job, as the offer and job screens should say it.
 *
 * `netPaise` is the job's payout before any fleet share, and it is what these
 * screens used to show. For an independent driver that is their money. For a
 * fleet driver on a split it overstated what they would be paid, and for a
 * driver on salary it promised money they would never receive per job (0042).
 * The server now sends the driver's own figure; this is the one place the app
 * turns it into words.
 */
export function yourEarningsText(earnings: JobEarnings): string {
  if (earnings.payModel === 'salary') return 'Paid by your fleet';
  return formatPaise(earnings.driverSharePaise);
}

/** The Accept button: an amount when there is one, just "Accept" on salary. */
export function acceptLabel(earnings: JobEarnings): string {
  return earnings.payModel === 'salary'
    ? 'Accept'
    : `Accept \u00b7 ${formatPaise(earnings.driverSharePaise)}`;
}

/**
 * The small line under the amount. The fleet's share is named when there is
 * one, so a driver on a split can see where the rest of the payout went.
 */
export function earningsBreakdownText(earnings: JobEarnings): string {
  const fee = `${formatPaise(earnings.grossPaise)} fare \u2212 ${formatPaise(earnings.commissionPaise)}${
    earnings.commissionPct === null ? '' : ` (${earnings.commissionPct}%)`
  } platform fee`;
  if (earnings.payModel === 'share' && earnings.fleetSharePaise > 0) {
    return `${fee} \u2212 ${formatPaise(earnings.fleetSharePaise)} your fleet`;
  }
  if (earnings.payModel === 'salary') return `${fee} \u00b7 your fleet pays your salary`;
  return fee;
}
