import { Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  analyticsExportQuerySchema,
  analyticsRangeQuerySchema,
  analyticsRollupRequestSchema,
  type AnalyticsDriverResponse,
  type AnalyticsExportQuery,
  type AnalyticsGeoResponse,
  type AnalyticsRangeQuery,
  type AnalyticsRevenueResponse,
  type AnalyticsRollupRequest,
  type AnalyticsRollupResponse,
  type AnalyticsSummaryResponse,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodQuery } from '../../common/validation/zod.decorators';
import { Inject } from '@nestjs/common';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { sessionContextFrom } from '../auth/token.service';
import { AnalyticsRollupService } from './analytics-rollup.service';
import { AnalyticsService } from './analytics.service';

/**
 * W17 — §9.4.13's analytics surface, `/admin/analytics`.
 *
 * READING AND EXPORTING ARE SEPARATE PERMISSIONS. `analytics.view` is the
 * union of the guide's "ops.live or finance.read" (the guard is AND-only, so
 * the union is its own row in the map); `analytics.export` gates the CSV
 * download and the manual rollup. Support holds view but its export row is
 * the Part 6 "⚠️ non-financial" case — the endpoints are aggregate-only, so
 * there is nothing financial to redact at this grain.
 */
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminAnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly rollups: AnalyticsRollupService,
    private readonly audit: AdminAuditService,
    @Inject(QUEUE) private readonly queue: QueuePort,
  ) {}

  @Get('summary')
  @Permissions('analytics.view')
  summary(
    @ZodQuery(analyticsRangeQuerySchema) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsSummaryResponse> {
    return this.analytics.summary(query);
  }

  @Get('marketplace')
  @Permissions('analytics.view')
  marketplace(
    @ZodQuery(analyticsRangeQuerySchema) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsSummaryResponse> {
    return this.analytics.marketplace(query);
  }

  @Get('revenue')
  @Permissions('analytics.view')
  revenue(
    @ZodQuery(analyticsRangeQuerySchema) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsRevenueResponse> {
    return this.analytics.revenue(query);
  }

  @Get('drivers')
  @Permissions('analytics.view')
  drivers(
    @ZodQuery(analyticsRangeQuerySchema) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsDriverResponse> {
    return this.analytics.drivers(query);
  }

  @Get('geo')
  @Permissions('analytics.view')
  geo(
    @ZodQuery(analyticsRangeQuerySchema) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsGeoResponse> {
    return this.analytics.geo(query);
  }

  /** A byte stream, not a DTO — shape asserted in `analytics.e2e.spec.ts`. */
  @Get('export.csv')
  @Permissions('analytics.export')
  export(
    @ZodQuery(analyticsExportQuerySchema) query: AnalyticsExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    return this.analytics.exportCsv(query, res);
  }

  /**
   * The cron's on-demand twin — operationally necessary (a failed nightly run
   * must be re-runnable without shell access) and what makes the live-look
   * rehearsal honest. Audited like any other admin write.
   */
  @Post('rollup')
  @Permissions('analytics.export')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  async rollup(
    @ZodBody(analyticsRollupRequestSchema) body: AnalyticsRollupRequest,
    @Req() request: AuthedRequest,
  ): Promise<AnalyticsRollupResponse> {
    const auth = request.auth;
    if (!auth) throw ApiException.unauthorized();

    const day = this.rollups.targetDay(body.day);
    await this.queue.enqueue(
      'analytics.rollup',
      { reason: 'manual', day },
      {
        jobId: `analytics:${day}:manual:${Date.now()}`,
      },
    );

    await this.audit.record({
      adminId: auth.sub,
      action: 'analytics.rollup',
      subjectType: 'analytics',
      subjectId: null,
      before: null,
      after: { day, reason: 'manual' },
      reason: body.day ? `Recompute ${day}` : 'Recompute yesterday',
      ip: sessionContextFrom(request).ip ?? null,
      userAgent: sessionContextFrom(request).userAgent ?? null,
    });

    return { queued: true, day };
  }
}
