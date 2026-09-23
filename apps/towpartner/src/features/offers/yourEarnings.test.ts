import type { JobEarnings } from '@towing/api-contracts';
import { acceptLabel, earningsBreakdownText, yourEarningsText } from './yourEarnings';

// ₹1,000 trip, 10 % commission, a ₹900 payout — the backend's fleet-pay spec.
const base = {
  grossPaise: 100_000,
  band: 'A',
  commissionPct: 10,
  commissionPaise: 10_000,
  netPaise: 90_000,
} as const;

const independent: JobEarnings = {
  ...base,
  payModel: 'independent',
  driverSharePaise: 90_000,
  fleetSharePaise: 0,
};
const share: JobEarnings = {
  ...base,
  payModel: 'share',
  driverSharePaise: 72_000,
  fleetSharePaise: 18_000,
};
const salary: JobEarnings = {
  ...base,
  payModel: 'salary',
  driverSharePaise: 0,
  fleetSharePaise: 90_000,
};

describe('what the driver is told they earn (0042)', () => {
  it("shows a fleet driver on a split their share, not the job's payout", () => {
    expect(yourEarningsText(share)).toContain('720');
    expect(yourEarningsText(share)).not.toContain('900');
    expect(earningsBreakdownText(share)).toContain('180');
    expect(acceptLabel(share)).toContain('720');
  });

  it('shows an independent driver the whole payout, with no fleet line', () => {
    expect(yourEarningsText(independent)).toContain('900');
    expect(earningsBreakdownText(independent)).not.toMatch(/fleet/);
  });

  it('never promises a salaried driver money per job', () => {
    expect(yourEarningsText(salary)).toBe('Paid by your fleet');
    expect(acceptLabel(salary)).toBe('Accept');
    expect(earningsBreakdownText(salary)).toContain('salary');
  });
});
