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
  adminBannerCreateSchema,
  adminBannerPresignSchema,
  adminBannerUpdateSchema,
  type AdminBanner,
  type AdminBannerCreate,
  type AdminBannerPresign,
  type AdminBannerPresignResponse,
  type AdminBannersResponse,
  type AdminBannerUpdate,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { BannersService } from './banners.service';

/**
 * W16 — the banner manager, `promo.manage` (super admin + operations), the
 * same pair that owns coupons: one screen, one authority.
 *
 * Uploads are `money`-bucketed like every other admin write; the presign route
 * included, because minting upload keys is the one route here a script would
 * hammer.
 */
@Controller('admin/banners')
@UseGuards(JwtAuthGuard)
@Realms('admin')
@Permissions('promo.manage')
export class AdminBannersController {
  constructor(private readonly banners: BannersService) {}

  @Get()
  list(): Promise<AdminBannersResponse> {
    return this.banners.listAdmin();
  }

  @Post()
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  create(
    @ZodBody(adminBannerCreateSchema) body: AdminBannerCreate,
    @Req() request: AuthedRequest,
  ): Promise<AdminBanner> {
    return this.banners.create(adminId(request), body, sessionContextFrom(request));
  }

  /**
   * Declared BEFORE the parameterised routes below it — Express matches in
   * registration order and `POST /admin/banners/presign` would otherwise sit
   * behind `POST /admin/banners` in a reader's head. (`presign` is a static
   * segment, so this is clarity, not a bug fix.)
   */
  @Post('presign')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  presign(
    @ZodBody(adminBannerPresignSchema) body: AdminBannerPresign,
    @Req() request: AuthedRequest,
  ): Promise<AdminBannerPresignResponse> {
    return this.banners.presign(adminId(request), body.contentType);
  }

  @Put(':id')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(adminBannerUpdateSchema) body: AdminBannerUpdate,
    @Req() request: AuthedRequest,
  ): Promise<AdminBanner> {
    return this.banners.update(adminId(request), id, body, sessionContextFrom(request));
  }
}

function adminId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
