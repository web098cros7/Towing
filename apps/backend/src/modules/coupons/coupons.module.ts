import { Controller, HttpCode, HttpStatus, Module, Post, Req, UseGuards } from '@nestjs/common';
import {
  couponValidateRequestSchema,
  type CouponValidateRequest,
  type CouponValidationDto,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
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
}

@Module({
  imports: [AuthModule],
  controllers: [CouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
