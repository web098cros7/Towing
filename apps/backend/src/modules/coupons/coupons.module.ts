import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  couponValidateRequestSchema,
  type CouponOffer,
  type CouponValidateRequest,
  type CouponValidationDto,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { AuthModule } from '../auth/auth.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { AdminCouponsController } from './admin-coupons.controller';
import { AdminCouponsService } from './admin-coupons.service';
import { CouponsService } from './coupons.service';

/**
 * `POST /v1/coupons/validate` — §9.4.11's server-side validation, which is the
 * only kind that counts.
 *
 * `@ThrottleBucket('money')` because this IS a code-guessing surface: a
 * discount code is a short shared secret, and an unthrottled oracle that says
 * whether one exists is an invitation to enumerate them.
 */
@Controller('coupons')
@UseGuards(JwtAuthGuard)
@Realms('customer')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Post('validate')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  validate(
    @ZodBody(couponValidateRequestSchema) body: CouponValidateRequest,
    @Req() request: AuthedRequest,
  ): Promise<CouponValidationDto> {
    const auth = request.auth;
    if (!auth) throw ApiException.unauthorized();
    return this.coupons.validate(auth.sub, body.code, body.subtotalPaise);
  }

  /** The customer's "Available offers" list (Figma 28). */
  @Get('offers')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  async offers(@Req() request: AuthedRequest): Promise<{ items: CouponOffer[] }> {
    const auth = request.auth;
    if (!auth) throw ApiException.unauthorized();
    return { items: await this.coupons.offers(auth.sub) };
  }
}

@Module({
  imports: [AuthModule, AdminAuthModule],
  controllers: [CouponsController, AdminCouponsController],
  providers: [CouponsService, AdminCouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
