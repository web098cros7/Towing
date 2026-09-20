import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  adminNotificationDeliveriesQuerySchema,
  adminNotificationTestSendSchema,
  type AdminNotificationDeliveriesQuery,
  type AdminNotificationDeliveriesResponse,
  type AdminNotificationTemplatesResponse,
  type AdminNotificationTestSend,
  type AdminNotificationTestSendResponse,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions, Realms } from '../auth/realm.decorator';
import { AdminNotificationsService } from './admin-notifications.service';

/**
 * W18 — `/admin/notifications` (§12.3): the read-only catalogue, the delivery
 * log, and the one guarded write.
 *
 * READING IS `notification.view` (super/ops/support — the people who work
 * delivery incidents); the TEST-SEND is `admin.manage` (super admin only), the
 * guide's own gate, because it is the one route here that causes a message to
 * leave the building.
 */
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard)
@Realms('admin')
export class AdminNotificationsController {
  constructor(private readonly notifications: AdminNotificationsService) {}

  @Get('templates')
  @Permissions('notification.view')
  templates(): AdminNotificationTemplatesResponse {
    return this.notifications.templates();
  }

  @Get('deliveries')
  @Permissions('notification.view')
  deliveries(
    @ZodQuery(adminNotificationDeliveriesQuerySchema) query: AdminNotificationDeliveriesQuery,
  ): Promise<AdminNotificationDeliveriesResponse> {
    return this.notifications.deliveries(query);
  }

  /**
   * `POST`ed because it sends — a GET test-send is a bug waiting for a link
   * preview to fire it. `money`-bucketed: the route costs real money the
   * moment a provider is bound.
   */
  @Post('test-send')
  @Permissions('admin.manage')
  @ThrottleBucket('money')
  @HttpCode(HttpStatus.OK)
  testSend(
    @ZodBody(adminNotificationTestSendSchema) body: AdminNotificationTestSend,
    @Req() request: AuthedRequest,
  ): Promise<AdminNotificationTestSendResponse> {
    const auth = request.auth;
    if (!auth) throw ApiException.unauthorized();
    return this.notifications.testSend(auth.sub, body);
  }
}
