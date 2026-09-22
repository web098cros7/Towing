import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  bookingMessageCreateSchema,
  type BookingMessageCreate,
  type BookingMessagesResponse,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ZodBody, ZodParam } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycApprovedGuard } from '../auth/kyc-approved.guard';
import { Realms } from '../auth/realm.decorator';
import { driverId } from '../driver-kyc/driver-kyc.controller';
import { customerId } from '../me/me.controller';
import { BookingChatService } from './booking-chat.service';

/**
 * Figma 24's "Chat with Driver" — the customer's side of the thread.
 *
 * Customer-only, and keyed by booking id: the service 404s a booking that is
 * not this customer's, so the id is not a capability.
 */
@Controller('bookings')
@UseGuards(JwtAuthGuard)
@Realms('customer')
export class CustomerBookingChatController {
  constructor(private readonly chat: BookingChatService) {}

  @Get(':id/messages')
  async list(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<BookingMessagesResponse> {
    return this.chat.list({ type: 'customer', userId: customerId(request) }, bookingId);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  async send(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @ZodBody(bookingMessageCreateSchema) body: BookingMessageCreate,
    @Req() request: AuthedRequest,
  ) {
    return this.chat.send({ type: 'customer', userId: customerId(request) }, bookingId, body);
  }
}

/**
 * The driver's side of the same thread, on the `jobs` prefix so it sits beside
 * the rest of the driver's job routes. `KycApprovedGuard` matches
 * `JobExecutionController` — a suspended driver cannot chat on a job.
 */
@Controller('jobs')
@UseGuards(JwtAuthGuard, KycApprovedGuard)
@Realms('driver')
export class DriverBookingChatController {
  constructor(private readonly chat: BookingChatService) {}

  @Get(':id/messages')
  async list(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @Req() request: AuthedRequest,
  ): Promise<BookingMessagesResponse> {
    return this.chat.list({ type: 'driver', driverId: driverId(request) }, bookingId);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  async send(
    @ZodParam(z.uuid(), 'id') bookingId: string,
    @ZodBody(bookingMessageCreateSchema) body: BookingMessageCreate,
    @Req() request: AuthedRequest,
  ) {
    return this.chat.send({ type: 'driver', driverId: driverId(request) }, bookingId, body);
  }
}
