import { env } from '@/lib/env';
import type { ChatMessage } from '../types';
import { chatMockSource } from './chatMockSource';
import { chatRestSource } from './chatRestSource';

/**
 * The customer ↔ driver conversation of one booking (Figma 22 · Chat with Driver).
 *
 * Mock mode runs on an app-local conversation; live mode talks to
 * `bookings/:id/messages` and receives pushes over the `/customer` socket
 * (`chat:message`), with a 5 s poll as the fallback.
 */
export interface ChatDataSource {
  /** The whole conversation, oldest first, in the order the messages were sent. */
  list(bookingId: string): Promise<ChatMessage[]>;
  /** Sends one customer message; resolves with it as stored (id and `sentAt`). */
  send(bookingId: string, text: string): Promise<ChatMessage>;
}

export const chatDataSource: ChatDataSource = env.useMocks ? chatMockSource : chatRestSource;
