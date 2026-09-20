import type { AdminCouponsQuery } from '@towing/api-contracts';

export const adminPromotionsKeys = {
  all: ['admin-promotions'] as const,
  coupons: (query: Partial<AdminCouponsQuery>) =>
    [...adminPromotionsKeys.all, 'coupons', query] as const,
  redemptions: (couponId: string, page: number) =>
    [...adminPromotionsKeys.all, 'redemptions', couponId, page] as const,
  banners: () => [...adminPromotionsKeys.all, 'banners'] as const,
};
