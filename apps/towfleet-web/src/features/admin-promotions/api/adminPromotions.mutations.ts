'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AdminBannerCreate,
  AdminBannerUpdate,
  AdminCouponCreate,
  AdminCouponUpdate,
} from '@towing/api-contracts';
import { adminPromotionsKeys } from './adminPromotions.keys';
import { adminPromotionsDataSource } from './adminPromotionsDataSource';

/**
 * W16's writes. Each one invalidates the feature's whole key on success: a
 * coupon edit changes the list, the redemptions counter and (via the invite
 * preview) nothing else — one invalidation is cheaper than reasoning about
 * which sub-key moved, and these screens are small.
 */

export function useCreateCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminCouponCreate) => adminPromotionsDataSource.createCoupon(body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminPromotionsKeys.all }),
  });
}

export function useUpdateCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ couponId, body }: { couponId: string; body: AdminCouponUpdate }) =>
      adminPromotionsDataSource.updateCoupon(couponId, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminPromotionsKeys.all }),
  });
}

export function useCreateBanner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminBannerCreate) => adminPromotionsDataSource.createBanner(body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminPromotionsKeys.all }),
  });
}

export function useUpdateBanner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bannerId, body }: { bannerId: string; body: AdminBannerUpdate }) =>
      adminPromotionsDataSource.updateBanner(bannerId, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminPromotionsKeys.all }),
  });
}

export function useUploadBannerImage() {
  return useMutation({
    mutationFn: (file: File) => adminPromotionsDataSource.uploadBannerImage(file),
  });
}
