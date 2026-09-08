import type {
  EarningsSummaryDto,
  EarningsTrendPointDto,
  JobSplitDto,
  PayoutDto,
  PayoutStatus,
} from '@towing/api-contracts';

/**
 * Thin aliases over the contract types.
 *
 * Before Phase 7 this file hand-declared its own shapes, including a
 * `PayoutStatus` whose first state was `pending` while the database enum said
 * `requested` (§5.5). Deriving them from the contract is what makes that class
 * of drift impossible rather than merely unlikely.
 */
export type EarningsSummary = EarningsSummaryDto;
export type EarningsTrendPoint = EarningsTrendPointDto;
export type JobSplit = JobSplitDto;
export type Payout = PayoutDto;
export type { PayoutStatus };

/**
 * `type`, not `interface`: only type aliases get an implicit index signature,
 * which is what lets these be spread straight into the query-string builder.
 */
export type SplitsFilter = {
  from?: string;
  to?: string;
  driverId?: string;
};

export type DateRange = {
  from?: string;
  to?: string;
};
