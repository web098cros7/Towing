import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/jwt-auth.guard';
import { AppConfigRepo } from './app-config.repo';

/**
 * `GET /v1/app-config` — W12.
 *
 * PUBLIC ON PURPOSE, and it is the only public config route in the product.
 * §19.8's minimum-supported-version gate has to be readable by the very build
 * it is gating: a client that must force-upgrade cannot first be required to
 * authenticate, because the session it would use comes from the API it is too
 * old to call. The payload carries nothing sensitive — two version floors, a
 * boolean, and the banner an operator deliberately published.
 *
 * CACHED + ETag/304. Both apps read it at launch and on resume, so it is the
 * highest-frequency request in the product; a 304 is the difference between a
 * config fetch and a config transfer on every foreground. `Cache-Control` is
 * short because §19.9 wants a SEV banner visible quickly — the ETag saves the
 * body, the short max-age caps how stale a WITHDRAWN banner can be.
 */
@Controller('app-config')
export class AppConfigController {
  constructor(private readonly config: AppConfigRepo) {}

  @Public()
  @Get()
  async get(@Req() request: Request, @Res() res: Response): Promise<void> {
    const config = await this.config.load();
    const etag = this.config.etag(config);

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=60');

    // `If-None-Match` may arrive as a list; the tag is compared verbatim, which
    // is what a single-tag client sends and all this route needs to support.
    if (request.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.status(200).json(config);
  }
}
