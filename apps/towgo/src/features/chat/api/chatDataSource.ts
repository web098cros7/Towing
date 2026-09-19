import { env } from '@/lib/env';
import type { ChatMessage } from '../types';
import { chatMockSource } from './chatMockSource';
import { chatRestSource } from './chatRestSource';

/**
 * The customer ↔ driver conversation of one booking (Figma 22 · Chat with Driver).
 *
 * THERE IS NO CHAT BACKEND (22 spec, Data gap 1), so only the mock does anything.
 * That is also why the screen is reachable in mock mode only: `openDriverChat`
 * opens 22 when `env.useMocks` is on and hands the driver's number to the phone's
 * messages app otherwise. The REST source exists so the switch below has two
 * sides and a live build fails loudly on send instead of pretending.
 */
export interface ChatDataSource {
  /** The whole conversation, oldest first, in the order the messages were sent. */
  list(bookingId: string): Promise<ChatMessage[]>;
  /** Sends one customer message; resolves with it as stored (id and `sentAt`). */
  send(bookingId: string, text: string): Promise<ChatMessage>;
}

export const chatDataSource: ChatDataSource = env.useMocks ? chatMockSource : chatRestSource;
