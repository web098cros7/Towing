import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { primaryId } from './columns';
import { bookings } from './bookings';

/**
 * Driver↔customer chat for one trip (Figma 24). Both parties read and write
 * only while they are on the booking; `sender_type` distinguishes the two
 * sides without a join, and `read_at` is the recipient's read receipt.
 */
export const bookingMessages = pgTable(
  'booking_messages',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    senderType: text('sender_type').notNull(),
    senderId: uuid('sender_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [index('idx_booking_messages_booking').on(t.bookingId, t.createdAt)],
);
