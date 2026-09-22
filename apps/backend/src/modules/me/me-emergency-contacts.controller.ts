import {
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
  emergencyContactCreateSchema,
  emergencyContactUpdateSchema,
  type EmergencyContactCreate,
  type EmergencyContactUpdate,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ZodBody, ZodParam } from '../../common/validation/zod.decorators';
import type { AuthedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { customerId } from './me.controller';
import { MeEmergencyContactsService } from './me-emergency-contacts.service';

@Controller('me/emergency-contacts')
@UseGuards(JwtAuthGuard)
@Realms('customer')
export class MeEmergencyContactsController {
  constructor(private readonly contacts: MeEmergencyContactsService) {}

  @Get()
  list(@Req() request: AuthedRequest) {
    return this.contacts.list(customerId(request));
  }

  @Post()
  create(
    @ZodBody(emergencyContactCreateSchema) body: EmergencyContactCreate,
    @Req() request: AuthedRequest,
  ) {
    return this.contacts.create(customerId(request), body);
  }

  @Put(':id')
  update(
    @ZodParam(z.uuid(), 'id') contactId: string,
    @ZodBody(emergencyContactUpdateSchema) body: EmergencyContactUpdate,
    @Req() request: AuthedRequest,
  ) {
    return this.contacts.update(customerId(request), contactId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@ZodParam(z.uuid(), 'id') contactId: string, @Req() request: AuthedRequest): Promise<void> {
    await this.contacts.remove(customerId(request), contactId);
  }
}
