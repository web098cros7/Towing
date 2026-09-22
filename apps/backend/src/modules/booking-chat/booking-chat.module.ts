import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DriverPresenceModule } from '../driver-presence/driver-presence.module';
import {
  CustomerBookingChatController,
  DriverBookingChatController,
} from './booking-chat.controller';
import { BookingChatService } from './booking-chat.service';

/**
 * Figma 24's chat. `AuthModule` for the guards, `BookingsModule` for the state
 * machine's `ACTIVE_JOB_STATUSES`, `DriverPresenceModule` for the driver
 * gateway the service emits on.
 */
@Module({
  imports: [AuthModule, BookingsModule, DriverPresenceModule],
  controllers: [CustomerBookingChatController, DriverBookingChatController],
  providers: [BookingChatService],
})
export class BookingChatModule {}
