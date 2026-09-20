import { Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  sosCreateRequestSchema,
  type SosCancelResponse,
  type SosCreateRequest,
  type SosCreateResponse,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception';
import { ZodBody, ZodParam } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { SosService, type SosRequester } from './sos.service';

/**
 * §13's panic button — `POST /v1/sos`, from EITHER requester realm.
 *
 * `@Realms('customer', 'driver')` is the same both-realm shape
 * `account-privacy.controller.ts` uses. The realm decides the SUBJECT TYPE, and
 * the id comes from the token — never from the body, so one account cannot
 * raise an alert as another.
 *
 * Standalone (no booking) is allowed by default (G11): the person in trouble
 * is the point, and the console handles the rest. The identity of the requester
 * is never trusted from a path param for the same reason every other requester
 * route derives it from the JWT.
 */
@Controller('sos')
@UseGuards(JwtAuthGuard)
@Realms('customer', 'driver')
export class SosController {
  constructor(private readonly sos: SosService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  raise(
    @ZodBody(sosCreateRequestSchema) body: SosCreateRequest,
    @Req() request: AuthedRequest,
  ): Promise<SosCreateResponse> {
    return this.sos.raise(requesterOf(request), body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @ZodParam(z.uuid(), 'id') id: string,
    @Req() request: AuthedRequest,
  ): Promise<SosCancelResponse> {
    return this.sos.cancel(requesterOf(request), id);
  }
}

function requesterOf(request: AuthedRequest): SosRequester {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  if (auth.role === 'customer') return { subjectType: 'user', subjectId: auth.sub };
  if (auth.role === 'driver') return { subjectType: 'driver', subjectId: auth.sub };
  throw ApiException.forbidden();
}
