import type { BookingMessage } from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { ChatMessage } from '../types';
import type { ChatDataSource } from './chatDataSource';

/**
 * The live side of the driver chat (Figma 22 · Chat with Driver).
 *
 * `GET bookings/:id/messages` returns the whole conversation oldest first and
 * marks the driver's messages read as a side effect; `POST bookings/:id/messages`
 * appends one customer message and 409s when the trip is not active (no driver
 * assigned, or already finished).
 *
 * The `/customer` socket pushes `chat:message` for BOTH sides' messages, so the
 * screen's fast path is the socket and this REST source is the fallback (the
 * 5 s poll in `useChatMessages`) plus the write path.
 */
export const chatRestSource: ChatDataSource = {
  async list(bookingId: string): Promise<ChatMessage[]> {
    const { items } = await apiFetch<{ items: BookingMessage[] }>(
      `bookings/${bookingId}/messages`,
    );
    return items.map(toChatMessage);
  },

  async send(bookingId: string, text: string): Promise<ChatMessage> {
    const message = await apiFetch<BookingMessage>(`bookings/${bookingId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: text }),
      idempotent: true,
    });
    return toChatMessage(message);
  },
};

/** Maps the wire contract onto the app's `ChatMessage`. Exported for the socket merge. */
export function toChatMessage(message: BookingMessage): ChatMessage {
  return {
    id: message.id,
    bookingId: message.bookingId,
    sender: message.senderType,
    text: message.body,
    sentAt: message.createdAt,
  };
}
