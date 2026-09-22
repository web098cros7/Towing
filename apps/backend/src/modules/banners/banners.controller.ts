import { Controller, Get, Header } from '@nestjs/common';
import {
  publicBannersQuerySchema,
  type PublicBannersQuery,
  type PublicBannersResponse,
} from '@towing/api-contracts';
import { ZodQuery } from '../../common/validation/zod.decorators';
import { Public } from '../auth/jwt-auth.guard';
import { BannersService } from './banners.service';

/**
 * `GET /v1/banners?audience=` — the carousel content the apps read (§9.1.4,
 * W16).
 *
 * PUBLIC, like `GET /v1/content/:kind` and for the same reason: a marketing
 * carousel is content the home screen renders before anybody signs in, and it
 * carries nothing a session would protect (a title, an image URL, a CTA). The
 * audience filter is a query parameter, not a separate route — the driver app
 * and the customer app read the same table with different rows.
 *
 * The short cache is deliberate: banners change at human speed, and the window
 * is evaluated server-side on every read anyway, so a 60-second stale copy can
 * only ever be a banner that just went live, never one that should have
 * expired.
 */
@Controller('banners')
export class BannersController {
  constructor(private readonly banners: BannersService) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  list(
    @ZodQuery(publicBannersQuerySchema) query: PublicBannersQuery,
  ): Promise<PublicBannersResponse> {
    return this.banners.listPublic(query.audience);
  }
}
