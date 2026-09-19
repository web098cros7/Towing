import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountPrivacyController } from './account-privacy.controller';
import { AccountPrivacyService } from './account-privacy.service';
import { MeAddressesController } from './me-addresses.controller';
import { MeAddressesService } from './me-addresses.service';
import { MeEmergencyContactsController } from './me-emergency-contacts.controller';
import { MeEmergencyContactsService } from './me-emergency-contacts.service';
import { MeVehiclesController } from './me-vehicles.controller';
import { MeVehiclesService } from './me-vehicles.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';

/**
 * `/v1/me` — the customer's own profile group (Phase 12), plus the dual-realm
 * (customer + driver) §20.4 DPDP routes (`AccountPrivacyController`).
 * `PresignedUploadService` (RC photo uploads) comes from the global
 * `StorageModule`, not imported here.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    MeController,
    MeVehiclesController,
    MeAddressesController,
    MeEmergencyContactsController,
    AccountPrivacyController,
  ],
  providers: [
    MeService,
    MeVehiclesService,
    MeAddressesService,
    MeEmergencyContactsService,
    AccountPrivacyService,
  ],
  // W6: the admin app-view's vehicles/addresses sections read through these.
  exports: [MeVehiclesService, MeAddressesService],
})
export class MeModule {}
