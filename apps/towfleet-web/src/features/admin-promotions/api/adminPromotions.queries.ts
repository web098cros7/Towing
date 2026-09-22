'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminCouponsQuery } from '@towing/api-contracts';
import { adminPromotionsKeys } from './adminPromotions.keys';
import { adminPromotionsDataSource } from './adminPromotionsDataSource';

export function useAdminCoupons(query: AdminCouponsQuery) {
  return useQuery({
    queryKey: adminPromotionsKeys.coupons(query),
    queryFn: () => adminPromotionsDataSource.listCoupons(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/** The redemption ledger behind the counter; only fetched while a coupon is open. */
export function useCouponRedemptions(couponId: string | null, page: number) {
  return useQuery({
    queryKey: adminPromotionsKeys.redemptions(couponId ?? '', page),
    queryFn: () => adminPromotionsDataSource.listRedemptions(couponId as string, page, 25),
    enabled: Boolean(couponId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAdminBanners() {
  return useQuery({
    queryKey: adminPromotionsKeys.banners(),
    queryFn: () => adminPromotionsDataSource.listBanners(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
