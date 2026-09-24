import { Controller, Delete, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  accountDeletionRequestSchema,
  consentRecordRequestSchema,
  type ConsentStatus,
  consentWithdrawRequestSchema,
  type AccountDeletionRequest,
  type ConsentRecordRequest,
  type ConsentWithdrawRequest,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ZodBody } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { AccountPrivacyService, type PrivacySubjectType } from './account-privacy.service';

/**
 * §20.4 DPDP, dual-realm — mounted at `/me` alongside `MeController`, same
 * path-prefix-split precedent as Phase 11's `admin-auth`/`admin-drivers` (no
 * route collision, distinct method+path pairs). `@Realms('customer','driver')`
 * overrides `MeController`'s customer-only default per handler.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
@Realms('customer', 'driver')
export class AccountPrivacyController {
  constructor(private readonly privacy: AccountPrivacyService) {}

  @Delete()
  requestDeletion(
    @ZodBody(accountDeletionRequestSchema) body: AccountDeletionRequest,
    @Req() request: AuthedRequest,
  ) {
    const { subjectType, subjectId } = subjectFor(request);
    return this.privacy.requestDeletion(subjectType, subjectId, body.reason);
  }

  @Get('export')
  exportData(@Req() request: AuthedRequest) {
    const { subjectType, subjectId } = subjectFor(request);
    return this.privacy.exportData(subjectType, subjectId);
  }

  /** Whether this person already agreed, whatever phone they signed in on. */
  @Get('consent')
  consentStatus(@Req() request: AuthedRequest): Promise<ConsentStatus> {
    const { subjectType, subjectId } = subjectFor(request);
    return this.privacy.consentStatus(subjectType, subjectId);
  }

  @Post('consent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordConsent(
    @ZodBody(consentRecordRequestSchema) body: ConsentRecordRequest,
    @Req() request: AuthedRequest,
  ): Promise<void> {
    const { subjectType, subjectId } = subjectFor(request);
    await this.privacy.recordConsent(subjectType, subjectId, body);
  }

  /**
   * The withdrawal the consent overlay promises. Marketing stops; the account
   * keeps working, and the app says so before the customer confirms. Deleting
   * the account is `DELETE /v1/me`, deliberately a different button.
   */
  @Post('consent/withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  async withdrawConsent(
    @ZodBody(consentWithdrawRequestSchema) body: ConsentWithdrawRequest,
    @Req() request: AuthedRequest,
  ): Promise<void> {
    const { subjectType, subjectId } = subjectFor(request);
    await this.privacy.withdrawConsent(subjectType, subjectId, body);
  }
}

function subjectFor(request: AuthedRequest): { subjectType: PrivacySubjectType; subjectId: string } {
  const auth = request.auth;
  if (!auth) throw ApiException.unauthorized();
  if (auth.role === 'customer') return { subjectType: 'user', subjectId: auth.sub };
  if (auth.role === 'driver') return { subjectType: 'driver', subjectId: auth.sub };
  throw ApiException.forbidden();
}
