import type {
  AdminBanner,
  AdminBannerCreate,
  AdminBannerPresignResponse,
  AdminBannersResponse,
  AdminBannerUpdate,
  AdminCoupon,
  AdminCouponCreate,
  AdminCouponRedemptionsResponse,
  AdminCouponsQuery,
  AdminCouponsResponse,
  AdminCouponUpdate,
  BannerImageContentType,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import {
  mockBanners,
  mockCoupons,
  mockCreateBanner,
  mockCreateCoupon,
  mockRedemptions,
  mockUpdateBanner,
  mockUpdateCoupon,
  mockUploadBannerImage,
} from '../mocks/adminPromotions.mock';

/**
 * W16's promotions APIs (§9.4.11): the coupon manager and the banner manager.
 *
 * Mutations are LIVE in the mock (see `mocks/adminPromotions.mock.ts`) — see
 * that file's header for the one fiction (the image upload) and why it is the
 * only one.
 *
 * The upload is `presign → PUT bytes to the returned URL`, the same two-call
 * shape as KYC documents and dispute evidence. The bytes go straight to
 * storage (the disk adapter's signed `PUT /v1/files/:key` locally; S3 in
 * production), never through the admin proxy — which is why this one call is
 * a bare `fetch` against the URL the backend minted.
 */
export interface AdminPromotionsDataSource {
  listCoupons(query: AdminCouponsQuery): Promise<AdminCouponsResponse>;
  createCoupon(body: AdminCouponCreate): Promise<AdminCoupon>;
  updateCoupon(couponId: string, body: AdminCouponUpdate): Promise<AdminCoupon>;
  listRedemptions(
    couponId: string,
    page: number,
    limit: number,
  ): Promise<AdminCouponRedemptionsResponse>;

  listBanners(): Promise<AdminBannersResponse>;
  createBanner(body: AdminBannerCreate): Promise<AdminBanner>;
  updateBanner(bannerId: string, body: AdminBannerUpdate): Promise<AdminBanner>;
  uploadBannerImage(file: File): Promise<{ key: string }>;
}

const ALLOWED_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

const mockSource: AdminPromotionsDataSource = {
  listCoupons: async (query) => {
    const empty = { items: [], page: query.page, limit: query.limit, total: 0 };
    return resolveMock(env.mockAdminPromotionsState, mockCoupons(query), empty);
  },
  createCoupon: async (body) => {
    await mockDelay(300);
    return mockCreateCoupon(body);
  },
  updateCoupon: async (couponId, body) => {
    await mockDelay(300);
    return mockUpdateCoupon(couponId, body);
  },
  listRedemptions: async (couponId, page, limit) => {
    await mockDelay(200);
    return mockRedemptions(couponId, page, limit);
  },

  listBanners: async () => {
    await mockDelay(200);
    return resolveMock(env.mockAdminPromotionsState, mockBanners(), { items: [] });
  },
  createBanner: async (body) => {
    await mockDelay(300);
    return mockCreateBanner(body);
  },
  updateBanner: async (bannerId, body) => {
    await mockDelay(300);
    return mockUpdateBanner(bannerId, body);
  },
  uploadBannerImage: (file) => mockUploadBannerImage(file),
};

const restSource: AdminPromotionsDataSource = {
  listCoupons: (query) => {
    const params = new URLSearchParams({
      page: String(query.page),
      limit: String(query.limit),
    });
    if (query.code) params.set('code', query.code);
    if (query.isActive) params.set('isActive', query.isActive);
    return adminApiFetch<AdminCouponsResponse>(`coupons?${params.toString()}`);
  },

  createCoupon: (body) =>
    adminApiFetch<AdminCoupon>('coupons', { method: 'POST', body: JSON.stringify(body) }),

  updateCoupon: (couponId, body) =>
    adminApiFetch<AdminCoupon>(`coupons/${couponId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  listRedemptions: (couponId, page, limit) =>
    adminApiFetch<AdminCouponRedemptionsResponse>(
      `coupons/${couponId}/redemptions?page=${page}&limit=${limit}`,
    ),

  listBanners: () => adminApiFetch<AdminBannersResponse>('banners'),

  createBanner: (body) =>
    adminApiFetch<AdminBanner>('banners', { method: 'POST', body: JSON.stringify(body) }),

  updateBanner: (bannerId, body) =>
    adminApiFetch<AdminBanner>(`banners/${bannerId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  uploadBannerImage: async (file) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error('Upload a JPEG, PNG or WebP image');
    }
    const contentType = file.type as BannerImageContentType;
    const slot = await adminApiFetch<AdminBannerPresignResponse>('banners/presign', {
      method: 'POST',
      body: JSON.stringify({ contentType }),
    });

    const upload = await fetch(slot.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': contentType },
    });
    if (!upload.ok) throw new Error(`Image upload failed (${upload.status})`);

    return { key: slot.key };
  },
};

export const adminPromotionsDataSource: AdminPromotionsDataSource = env.useMocks
  ? mockSource
  : restSource;
