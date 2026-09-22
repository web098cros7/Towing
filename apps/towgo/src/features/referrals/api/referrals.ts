import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { env } from '@/lib/env';
import { walletKeys } from '@/features/payments/api/payments.keys';

export interface ReferralSummary {
  code: string;
  shareUrl: string;
  referrerRewardPaise: number;
  refereeRewardPaise: number;
  invitedCount: number;
  rewardedCount: number;
  earnedPaise: number;
  appliedCode: string | null;
  canApplyCode: boolean;
}

export interface ApplyReferralResult {
  status: 'pending';
  refereeRewardPaise: number;
}

const MOCK_SUMMARY: ReferralSummary = {
  code: 'RAHUL4K2P',
  shareUrl: 'https://mitow.in/r/RAHUL4K2P',
  referrerRewardPaise: 10000,
  refereeRewardPaise: 10000,
  invitedCount: 2,
  rewardedCount: 1,
  earnedPaise: 10000,
  appliedCode: null,
  canApplyCode: false,
};

const MOCK_APPLY: ApplyReferralResult = {
  status: 'pending',
  refereeRewardPaise: 10000,
};

export const referralKeys = {
  all: ['referral'] as const,
};

async function fetchReferralSummary(): Promise<ReferralSummary> {
  if (env.useMocks) return MOCK_SUMMARY;
  return apiFetch<ReferralSummary>('me/referral');
}

async function applyReferralCode(code: string): Promise<ApplyReferralResult> {
  if (env.useMocks) return MOCK_APPLY;
  return apiFetch<ApplyReferralResult>('me/referral/apply', {
    method: 'POST',
    body: JSON.stringify({ code }),
    idempotent: true,
  });
}

export function useReferral() {
  return useQuery({
    queryKey: referralKeys.all,
    queryFn: fetchReferralSummary,
  });
}

export function useApplyReferral() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => applyReferralCode(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referralKeys.all });
      queryClient.invalidateQueries({ queryKey: walletKeys.balance() });
    },
  });
}
