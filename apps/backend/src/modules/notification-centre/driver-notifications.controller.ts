import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  cursorQuerySchema,
  deviceRegisterSchema,
  deviceUnregisterSchema,
  notificationsReadRequestSchema,
  subjectNotificationPrefsUpdateSchema,
  type CursorQuery,
  type DeviceRegisterRequest,
  type DeviceUnregisterRequest,
  type NotificationsReadRequest,
  type SubjectNotificationPrefsUpdate,
} from '@towing/api-contracts';
import { DeviceRegistryService } from '../../common/notifications/device-registry.service';
import { ThrottleBucket } from '../../common/throttling/throttler.config';
import { ZodBody, ZodQuery } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { driverId } from '../driver-kyc/driver-kyc.controller';
import { NotificationCentreService } from './notification-centre.service';

/**
 * The driver half of the notification centre (§12, Phase 13) — the same six
 * routes under `/driver`, because the §12.2 matrix addresses drivers and
 * customers for different rows and both need the whole surface.
 *
 * ⚠ NOT `@Realms('driver')`-plus-`KycApprovedGuard`. A driver who is still
 * `incomplete` or has just been `rejected` is precisely the person the KYC
 * notifications are FOR, and gating the centre on approval would hide the
 * message telling them why they were not approved.
 *
 * Registering a device before approval also matters for the §9.4.3 acceptance
 * chain: the approval push has to arrive on a handset that registered while the
 * driver was still pending.
 */
@Controller('driver')
@UseGuards(JwtAuthGuard)
@Realms('driver')
export class DriverNotificationsController {
  constructor(
    private readonly centre: NotificationCentreService,
    private readonly devices: DeviceRegistryService,
  ) {}

  @Post('devices')
  @ThrottleBucket('money')
  registerDevice(
    @ZodBody(deviceRegisterSchema) body: DeviceRegisterRequest,
    @Req() request: AuthedRequest,
  ) {
    return this.devices.register('driver', driverId(request), body);
  }

  @Delete('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregisterDevice(@Body() rawBody: unknown, @Req() request: AuthedRequest): Promise<void> {
    const body = deviceUnregisterSchema.parse(rawBody) as DeviceUnregisterRequest;
    await this.devices.unregister('driver', driverId(request), body.installationId);
  }

  @Get('notifications')
  list(@ZodQuery(cursorQuerySchema) query: CursorQuery, @Req() request: AuthedRequest) {
    return this.centre.list('driver', driverId(request), query);
  }

  @Get('notifications/unread-count')
  async unreadCount(@Req() request: AuthedRequest) {
    return { unread: await this.centre.unreadCount('driver', driverId(request)) };
  }

  @Post('notifications/read')
  markRead(
    @ZodBody(notificationsReadRequestSchema) body: NotificationsReadRequest,
    @Req() request: AuthedRequest,
  ) {
    return this.centre.markRead('driver', driverId(request), body.ids);
  }

  @Get('notification-prefs')
  getPrefs(@Req() request: AuthedRequest) {
    return this.centre.getPrefs('driver', driverId(request));
  }

  /**
   * Shipped even though MiTow Driver has no preferences screen this phase — the
   * B2 slice contains exactly two bullets and a prefs screen is not one of
   * them. The capability exists so the driver-facing surface is a screen, not a
   * screen plus an API, whenever the next MiTow Driver slice lands.
   */
  @Put('notification-prefs')
  updatePrefs(
    @ZodBody(subjectNotificationPrefsUpdateSchema) body: SubjectNotificationPrefsUpdate,
    @Req() request: AuthedRequest,
  ) {
    return this.centre.updatePrefs('driver', driverId(request), body);
  }
}
