import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerRatingsController, DriverRatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';

/**
 * §9.1.10 / §9.2.5's two-way ratings.
 *
 * Its own module rather than a corner of `BookingsModule`, because the thing it
 * actually feeds is §6.2's dispatch scorer — `drivers.rating` is 15 % of every
 * matching decision — and burying that inside bookings would hide the
 * dependency from anyone reading either side of it.
 */
@Module({
  imports: [AuthModule],
  controllers: [CustomerRatingsController, DriverRatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
