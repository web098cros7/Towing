import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DriversController } from './drivers.controller';
import { DriversRepo } from './drivers.repo';
import { DriversService } from './drivers.service';

@Module({
  imports: [AuthModule],
  controllers: [DriversController],
  providers: [DriversService, DriversRepo],
  // `DriversService` (W6): the admin fleet directory lists a chosen fleet's
  // drivers through this service instead of a second query implementation.
  exports: [DriversService],
})
export class DriversModule {}
