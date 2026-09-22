import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCodes,
  type BookingMessage,
  type BookingMessageCreate,
  type BookingMessagesResponse,
} from '@towing/api-contracts';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { bookingMessages, bookings } from '../../db/schema';
import { ACTIVE_JOB_STATUSES } from '../bookings/booking-state-machine.service';
import { CustomerGateway } from '../bookings/customer.gateway';
import { DriverGateway } from '../driver-presence/driver.gateway';

type Party = { type: 'customer'; userId: string } | { type: 'driver'; driverId: string };

/**
 * Driver ↔ customer chat for one booking (Figma 24).
 *
 * The thread is open only while a driver is on the trip — before assignment
 * there is nobody to talk to, and after completion the booking is history.
 * `readAt` is stamped on the OTHER side's messages when a party lists the
 * thread, so a sender's own message stays unread until the recipient opens it.
 */
@Injectable()
export class BookingChatService {
  private readonly logger = new Logger(BookingChatService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly customerGateway: CustomerGateway,
    private readonly driverGateway: DriverGateway,
  ) {}

  private async loadForCustomer(userId: string, bookingId: string) {
    const [row] = await this.db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        driverId: bookings.driverId,
        status: bookings.status,
      })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)))
      .limit(1);

    if (!row) throw ApiException.notFound('Booking not found');
    return row;
  }

  private async loadForDriver(driverId: string, bookingId: string) {
    const [row] = await this.db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        driverId: bookings.driverId,
        status: bookings.status,
      })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.driverId, driverId)))
      .limit(1);

    if (!row) throw ApiException.notFound('Booking not found');
    return row;
  }

  private async load(party: Party, bookingId: string) {
    return party.type === 'customer'
      ? this.loadForCustomer(party.userId, bookingId)
      : this.loadForDriver(party.driverId, bookingId);
  }

  async list(party: Party, bookingId: string): Promise<BookingMessagesResponse> {
    const booking = await this.load(party, bookingId);

    // The OTHER side's messages become read the moment this party opens the
    // thread. A sender's own messages are never touched.
    const otherSide = party.type === 'customer' ? 'driver' : 'customer';
    await this.db
      .update(bookingMessages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(bookingMessages.bookingId, booking.id),
          eq(bookingMessages.senderType, otherSide),
          isNull(bookingMessages.readAt),
        ),
      );

    const rows = await this.db
      .select()
      .from(bookingMessages)
      .where(eq(bookingMessages.bookingId, booking.id))
      .orderBy(asc(bookingMessages.createdAt), asc(bookingMessages.id))
      .limit(500);

    return { items: rows.map((row) => this.toDto(row)) };
  }

  async send(party: Party, bookingId: string, body: BookingMessageCreate): Promise<BookingMessage> {
    const booking = await this.load(party, bookingId);

    if (!booking.driverId || !(ACTIVE_JOB_STATUSES as readonly string[]).includes(booking.status)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'Chat is open only while a driver is on this trip',
        { status: booking.status },
      );
    }

    const senderType = party.type === 'customer' ? 'customer' : 'driver';
    const senderId = party.type === 'customer' ? party.userId : party.driverId;

    const [row] = await this.db
      .insert(bookingMessages)
      .values({
        bookingId: booking.id,
        senderType,
        senderId,
        body: body.body,
      })
      .returning();

    const dto = this.toDto(row!);

    // A socket failure must not fail a stored message — the row is the truth,
    // the emit is best-effort delivery.
    try {
      this.customerGateway.emitChatMessage(booking.id, dto);
      this.driverGateway.emitChatMessage(booking.driverId, dto);
    } catch (error) {
      this.logger.warn(
        `chat emit failed for booking ${booking.id}: ${(error as Error).message}`,
      );
    }

    return dto;
  }

  private toDto(row: typeof bookingMessages.$inferSelect): BookingMessage {
    return {
      id: row.id,
      bookingId: row.bookingId,
      senderType: row.senderType as BookingMessage['senderType'],
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
    };
  }
}
