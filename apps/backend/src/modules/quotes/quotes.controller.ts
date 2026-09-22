import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { quoteRequestSchema, type QuoteRequest } from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { QuotesService } from './quotes.service';

/**
 * The customer's manual-quote routes (§7.3, W20).
 *
 * `@Realms('customer')` is mandatory, not decoration: a controller without it
 * is fleet-only (invariant 45), and this one is reached from TowGo.
 *
 * `POST /v1/quotes` rides the default `reads` bucket — filing a request moves
 * no money and a customer editing their notes is legitimate — while ACCEPT
 * takes the `money` bucket: it creates the booking and locks the fare, exactly
 * the class of write the money budget exists for.
 */
@Controller('quotes')
@UseGuards(JwtAuthGuard)
@Realms('customer')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  request(@ZodBody(quoteRequestSchema) body: QuoteRequest, @Req() request: AuthedRequest) {
    return this.quotes.request(selfId(request), body);
  }

  @Get()
  list(@Req() request: AuthedRequest) {
    return this.quotes.list(selfId(request));
  }

  @Post(':id/accept')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  accept(@ZodParam(z.uuid(), 'id') quoteId: string, @Req() request: AuthedRequest) {
    return this.quotes.accept(selfId(request), quoteId);
  }
}

function selfId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
