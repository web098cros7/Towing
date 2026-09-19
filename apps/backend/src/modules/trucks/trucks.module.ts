import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TruckImportsService } from './imports.service';
import { TrucksController } from './trucks.controller';
import { TrucksRepo } from './trucks.repo';
import { TrucksService } from './trucks.service';

@Module({
  imports: [AuthModule],
  controllers: [TrucksController],
  providers: [TrucksService, TrucksRepo, TruckImportsService],
  // `TrucksService` (W6): the admin fleet directory lists a chosen fleet's
  // trucks through this service instead of a second query implementation.
  exports: [TrucksRepo, TrucksService],
})
export class TrucksModule {}
