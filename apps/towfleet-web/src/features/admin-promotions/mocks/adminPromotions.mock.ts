import type {
  AdminBanner,
  AdminBannerCreate,
  AdminBannerUpdate,
  AdminCoupon,
  AdminCouponCreate,
  AdminCouponRedemption,
  AdminCouponRedemptionsResponse,
  AdminCouponsQuery,
  AdminCouponsResponse,
  AdminCouponUpdate,
  AdminBannersResponse,
} from '@towing/api-contracts';
import { mockDelay } from '@/lib/mockUtils';

/**
 * W16's promotions console, mocked with LIVE mutations (the SOS precedent):
 * creating a coupon and editing a banner are exactly the flows this screen
 * exists for, so a mock that throws `MOCKS_NEED_BACKEND` would make the e2e
 * suite unable to prove anything. Everything lives in module state — no
 * request leaves the browser.
 *
 * THE ONE FICTION: `uploadBannerImage` mints a mock key without uploading
 * bytes. The console shows the local blob preview, so the editor behaves
 * identically; only the object never reaches storage.
 *
 * Sentinel: a `reason` of `mock-failure` throws, the same contract the KYC
 * console's mocks keep — product UI code, never backend behaviour.
 */

const MOCK_FAILURE = 'mock-failure';

/** An inline SVG stands in for a real image so the table renders something. */
const mockImage = (label: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" fill="#2563EB"/><text x="16" y="68" fill="white" font-size="20" font-family="sans-serif">${label}</text></svg>`,
  )}`;

const HOURS = 3_600_000;
const DAYS = 86_400_000;

const couponSeed: AdminCoupon[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'SAVE20',
    kind: 'percent',
    percentValue: 20,
    flatValuePaise: null,
    maxDiscountPaise: 100_000,
    minOrderPaise: 50_000,
    maxUses: 500,
    maxUsesPerUser: 1,
    usedCount: 128,
    startsAt: null,
    expiresAt: new Date(Date.now() + 30 * DAYS).toISOString(),
    isActive: true,
    createdAt: new Date(Date.now() - 20 * DAYS).toISOString(),
    updatedAt: new Date(Date.now() - 2 * DAYS).toISOString(),
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    code: 'FLAT100',
    kind: 'flat',
    percentValue: null,
    flatValuePaise: 10_000,
    maxDiscountPaise: null,
    minOrderPaise: 80_000,
    maxUses: null,
    maxUsesPerUser: 2,
    usedCount: 41,
    startsAt: null,
    expiresAt: null,
    isActive: true,
    createdAt: new Date(Date.now() - 10 * DAYS).toISOString(),
    updatedAt: new Date(Date.now() - 10 * DAYS).toISOString(),
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    code: 'MONSOON15',
    kind: 'percent',
    percentValue: 15,
    flatValuePaise: null,
    maxDiscountPaise: null,
    minOrderPaise: 0,
    maxUses: 200,
    maxUsesPerUser: 1,
    usedCount: 200,
    startsAt: null,
    expiresAt: new Date(Date.now() - DAYS).toISOString(),
    isActive: false,
    createdAt: new Date(Date.now() - 60 * DAYS).toISOString(),
    updatedAt: new Date(Date.now() - 5 * DAYS).toISOString(),
  },
];

const bannerSeed: AdminBanner[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Launch offer',
    imageKey: 'banner-images/mock/banner-launch.png',
    imageUrl: mockImage('Launch offer ₹200 off'),
    ctaLink: 'towgo://offers',
    ctaLabel: 'Claim',
    audience: 'customer',
    startsAt: null,
    endsAt: null,
    isActive: true,
    sortOrder: 1,
    createdAt: new Date(Date.now() - 14 * DAYS).toISOString(),
    updatedAt: new Date(Date.now() - 14 * DAYS).toISOString(),
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title: 'Monsoon drive',
    imageKey: 'banner-images/mock/banner-monsoon.png',
    imageUrl: mockImage('Monsoon drive'),
    ctaLink: 'towgo://services',
    ctaLabel: 'Book now',
    audience: 'customer',
    startsAt: null,
    endsAt: new Date(Date.now() + 45 * DAYS).toISOString(),
    isActive: true,
    sortOrder: 2,
    createdAt: new Date(Date.now() - 7 * DAYS).toISOString(),
    updatedAt: new Date(Date.now() - 7 * DAYS).toISOString(),
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    title: 'Driver bonus week',
    imageKey: 'banner-images/mock/banner-driver.png',
    imageUrl: mockImage('Driver bonus week'),
    ctaLink: null,
    ctaLabel: null,
    audience: 'driver',
    startsAt: new Date(Date.now() + 2 * DAYS).toISOString(),
    endsAt: new Date(Date.now() + 9 * DAYS).toISOString(),
    isActive: true,
    sortOrder: 1,
    createdAt: new Date(Date.now() - 3 * DAYS).toISOString(),
    updatedAt: new Date(Date.now() - 3 * DAYS).toISOString(),
  },
];

const redemptionSeed: Record<string, AdminCouponRedemption[]> = {
  '11111111-1111-4111-8111-111111111111': [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      userId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      userName: 'Meera Nair',
      bookingId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      bookingCode: 'TW-9F3K2A',
      discountPaise: 40_000,
      createdAt: new Date(Date.now() - 4 * HOURS).toISOString(),
    },
  ],
  '22222222-2222-4222-8222-222222222222': [],
  '33333333-3333-4333-8333-333333333333': [],
};

let coupons: AdminCoupon[] = [...couponSeed];
let banners: AdminBanner[] = [...bannerSeed];
const redemptions: Record<string, AdminCouponRedemption[]> = redemptionSeed;

export function mockCoupons(query: AdminCouponsQuery): AdminCouponsResponse {
  const matched = coupons.filter((coupon) => {
    const codeMatches = query.code
      ? coupon.code.toLowerCase().includes(query.code.toLowerCase())
      : true;
    const activeMatches = query.isActive ? coupon.isActive === (query.isActive === 'true') : true;
    return codeMatches && activeMatches;
  });

  const offset = (query.page - 1) * query.limit;
  return {
    items: matched.slice(offset, offset + query.limit),
    page: query.page,
    limit: query.limit,
    total: matched.length,
  };
}

export function mockCreateCoupon(body: AdminCouponCreate): AdminCoupon {
  if (body.reason === MOCK_FAILURE) throw new Error('Mock failure — the coupon was not saved.');
  if (coupons.some((coupon) => coupon.code.toUpperCase() === body.code.toUpperCase())) {
    throw new Error('A coupon with that code already exists');
  }

  const now = new Date().toISOString();
  const coupon: AdminCoupon = {
    id: crypto.randomUUID(),
    code: body.code,
    kind: body.kind,
    percentValue: body.kind === 'percent' ? (body.percentValue ?? null) : null,
    flatValuePaise: body.kind === 'flat' ? (body.flatValuePaise ?? null) : null,
    maxDiscountPaise: body.maxDiscountPaise ?? null,
    minOrderPaise: body.minOrderPaise ?? 0,
    maxUses: body.maxUses ?? null,
    maxUsesPerUser: body.maxUsesPerUser ?? 1,
    usedCount: 0,
    startsAt: body.startsAt ?? null,
    expiresAt: body.expiresAt ?? null,
    isActive: body.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  };

  coupons = [coupon, ...coupons];
  return coupon;
}

export function mockUpdateCoupon(id: string, body: AdminCouponUpdate): AdminCoupon {
  if (body.reason === MOCK_FAILURE) throw new Error('Mock failure — the coupon was not saved.');
  const index = coupons.findIndex((coupon) => coupon.id === id);
  const existing = coupons[index];
  if (!existing) throw new Error('Coupon not found');

  const kind = body.kind ?? existing.kind;
  const percentValue =
    body.percentValue !== undefined
      ? body.percentValue
      : kind === 'percent'
        ? existing.percentValue
        : null;
  const flatValuePaise =
    body.flatValuePaise !== undefined
      ? body.flatValuePaise
      : kind === 'flat'
        ? existing.flatValuePaise
        : null;

  // `usedCount` is deliberately absent: the console never writes it, and the
  // mock must not prove a fiction the API would refuse.
  const updated: AdminCoupon = {
    ...existing,
    code: body.code ?? existing.code,
    kind,
    percentValue,
    flatValuePaise,
    maxDiscountPaise:
      body.maxDiscountPaise !== undefined ? body.maxDiscountPaise : existing.maxDiscountPaise,
    minOrderPaise: body.minOrderPaise ?? existing.minOrderPaise,
    maxUses: body.maxUses !== undefined ? body.maxUses : existing.maxUses,
    maxUsesPerUser: body.maxUsesPerUser ?? existing.maxUsesPerUser,
    startsAt: body.startsAt !== undefined ? body.startsAt : existing.startsAt,
    expiresAt: body.expiresAt !== undefined ? body.expiresAt : existing.expiresAt,
    isActive: body.isActive ?? existing.isActive,
    updatedAt: new Date().toISOString(),
  };

  coupons = coupons.map((coupon) => (coupon.id === id ? updated : coupon));
  return updated;
}

export function mockRedemptions(
  couponId: string,
  page: number,
  limit: number,
): AdminCouponRedemptionsResponse {
  const rows = redemptions[couponId] ?? [];
  const offset = (page - 1) * limit;
  return {
    items: rows.slice(offset, offset + limit),
    page,
    limit,
    total: rows.length,
  };
}

export function mockBanners(): AdminBannersResponse {
  const ordered = [...banners].sort(
    (a, b) => a.audience.localeCompare(b.audience) || a.sortOrder - b.sortOrder,
  );
  return { items: ordered };
}

export function mockCreateBanner(body: AdminBannerCreate): AdminBanner {
  if (body.reason === MOCK_FAILURE) throw new Error('Mock failure — the banner was not saved.');
  const now = new Date().toISOString();
  const banner: AdminBanner = {
    id: crypto.randomUUID(),
    title: body.title,
    imageKey: body.imageKey,
    imageUrl: mockImage(body.title),
    ctaLink: body.ctaLink ?? null,
    ctaLabel: body.ctaLabel ?? null,
    audience: body.audience,
    startsAt: body.startsAt ?? null,
    endsAt: body.endsAt ?? null,
    isActive: body.isActive ?? true,
    sortOrder: body.sortOrder ?? Math.max(0, ...banners.map((row) => row.sortOrder)) + 1,
    createdAt: now,
    updatedAt: now,
  };
  banners = [...banners, banner];
  return banner;
}

export function mockUpdateBanner(id: string, body: AdminBannerUpdate): AdminBanner {
  if (body.reason === MOCK_FAILURE) throw new Error('Mock failure — the banner was not saved.');
  const existing = banners.find((banner) => banner.id === id);
  if (!existing) throw new Error('Banner not found');

  const updated: AdminBanner = {
    ...existing,
    title: body.title ?? existing.title,
    imageKey: body.imageKey ?? existing.imageKey,
    ctaLink: body.ctaLink !== undefined ? body.ctaLink : existing.ctaLink,
    ctaLabel: body.ctaLabel !== undefined ? body.ctaLabel : existing.ctaLabel,
    audience: body.audience ?? existing.audience,
    startsAt: body.startsAt !== undefined ? body.startsAt : existing.startsAt,
    endsAt: body.endsAt !== undefined ? body.endsAt : existing.endsAt,
    isActive: body.isActive ?? existing.isActive,
    sortOrder: body.sortOrder ?? existing.sortOrder,
    updatedAt: new Date().toISOString(),
  };
  banners = banners.map((banner) => (banner.id === id ? updated : banner));
  return updated;
}

export async function mockUploadBannerImage(file: File): Promise<{ key: string }> {
  await mockDelay(400);
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  return { key: `banner-images/mock/banner-${crypto.randomUUID()}.${extension}` };
}
