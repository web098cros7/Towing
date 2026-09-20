import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';import {
  adminQuoteDecisionSchema,
  adminQuoteRejectSchema,
  adminQuotesQuerySchema,
  type AdminQuoteDecision,
  type AdminQuoteReject,
  type AdminQuotesQuery,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { QuotesService } from './quotes.service';

/**
 * W20 — the manual-quote queue (§7.3), `/admin/quotes`.
 *
 * Every write takes the `money` bucket: pricing a quote writes the number a
 * customer will pay and the commission split that follows from it, and a
 * compromised session must not be able to spray offers at 20 a minute.
 *
 * The detail route is parameterised and therefore EXCLUDED from the contracts
 * walk; its contract is asserted with `expectMatchesContract` in
 * `quotes.e2e.spec.ts`, which owns a real request.
 */
@Controller('admin/quotes')
@UseGuards(JwtAuthGuard)
@Realms('admin')
@Permissions('quote.manage')
export class AdminQuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  list(@ZodQuery(adminQuotesQuerySchema) query: AdminQuotesQuery) {
    return this.quotes.adminList(query);
  }

  @Get(':id')
  detail(@ZodParam(z.uuid(), 'id') quoteId: string) {
    return this.quotes.adminDetail(quoteId);
  }

  @Post(':id/quote')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  price(
    @ZodParam(z.uuid(), 'id') quoteId: string,
    @ZodBody(adminQuoteDecisionSchema) body: AdminQuoteDecision,
    @Req() request: AuthedRequest,
  ) {
    return this.quotes.quotePrice(selfId(request), quoteId, body, sessionContextFrom(request));
  }

  @Post(':id/reject')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  reject(
    @ZodParam(z.uuid(), 'id') quoteId: string,
    @ZodBody(adminQuoteRejectSchema) body: AdminQuoteReject,
    @Req() request: AuthedRequest,
  ) {
    return this.quotes.reject(selfId(request), quoteId, body, sessionContextFrom(request));
  }

  @Post(':id/expire')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  expire(@ZodParam(z.uuid(), 'id') quoteId: string, @Req() request: AuthedRequest) {
    return this.quotes.expire(selfId(request), quoteId, sessionContextFrom(request));
  }
}

function selfId(request: AuthedRequest): string {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  return auth.sub;
}
