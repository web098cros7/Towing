import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  adminCouponCreateSchema,
  adminCouponsQuerySchema,
  adminCouponUpdateSchema,
  pageQuerySchema,
  type AdminCoupon,
  type AdminCouponCreate,
  type AdminCouponRedemptionsResponse,
  type AdminCouponsQuery,
  type AdminCouponsResponse,
  type AdminCouponUpdate,
  type PageQuery,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AdminCouponsService } from './admin-coupons.service';

/**
 * W16 — §9.4.11's coupon manager, `promo.manage` (super admin + operations).
 *
 * A COUPON IS NEVER DELETED, ONLY SWITCHED OFF. `coupon_redemptions` rows
 * reference it and `bookings.coupon_id` points at it; deleting the definition
 * would orphan the evidence of what a past booking's discount was. The
 * customer route already treats an inactive code exactly like an unknown one
 * (anti-enumeration), so `isActive: false` IS "deleted" from the customer's
 * point of view — without destroying history.
 *
 * `used_count` is absent from both write contracts on purpose: a crafted body
 * cannot even ask to set it.
 */
@Controller('admin/coupons')
@UseGuards(JwtAuthGuard)
@Realms('admin')
@Permissions('promo.manage')
export class AdminCouponsController {
  constructor(private readonly coupons: AdminCouponsService) {}

  @Get()
  list(@ZodQuery(adminCouponsQuerySchema) query: AdminCouponsQuery): Promise<AdminCouponsResponse> {
    return this.coupons.list(query);
  }

  @Post()
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  create(
    @ZodBody(adminCouponCreateSchema) body: AdminCouponCreate,
    @Req() request: AuthedRequest,
  ): Promise<AdminCoupon> {
    return this.coupons.create(adminId(request), body, sessionContextFrom(request));
  }

  /** The redemption ledger behind `used_count` — the evidence one click deep. */
  @Get(':id/redemptions')
  redemptions(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodQuery(pageQuerySchema) query: PageQuery,
  ): Promise<AdminCouponRedemptionsResponse> {
    return this.coupons.redemptions(id, query);
  }

  @Put(':id')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(adminCouponUpdateSchema) body: AdminCouponUpdate,
    @Req() request: AuthedRequest,
  ): Promise<AdminCoupon> {
    return this.coupons.update(adminId(request), id, body, sessionContextFrom(request));
  }
}

function adminId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
