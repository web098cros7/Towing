import { z } from 'zod';

/**
 * Driver ↔ customer chat for one booking (Figma 24).
 *
 * The two parties are the only senders; the wire carries a single message
 * frame and a list of them. `readAt` is set by the OTHER side's read, so a
 * message the sender wrote is unread until the recipient opens the thread.
 */
export const BOOKING_CHAT_SENDERS = ['customer', 'driver'] as const;
export const bookingChatSenderSchema = z.enum(BOOKING_CHAT_SENDERS);
export type BookingChatSender = z.infer<typeof bookingChatSenderSchema>;

export const bookingMessageSchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  senderType: bookingChatSenderSchema,
  body: z.string(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export type BookingMessage = z.infer<typeof bookingMessageSchema>;

/** Oldest first — the order a chat thread is read in. */
export const bookingMessagesResponseSchema = z.object({
  items: z.array(bookingMessageSchema),
});
export type BookingMessagesResponse = z.infer<typeof bookingMessagesResponseSchema>;

export const bookingMessageCreateSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});
export type BookingMessageCreate = z.infer<typeof bookingMessageCreateSchema>;

/**
 * The socket event carrying one `bookingMessageSchema` frame.
 *
 * Sent on BOTH the `/customer` namespace (booking room) and the `/driver`
 * namespace (driver room) — the same fact, delivered to whichever side is
 * connected.
 */
export const BOOKING_CHAT_EVENT = 'chat:message' as const;
