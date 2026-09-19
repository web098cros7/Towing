import type { ChatMessage } from '../types';
import type { ChatDataSource } from './chatDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mock-mode chat.
 *
 * Every booking starts with the five messages Figma 22 draws, verbatim and in
 * the drawn order (driver, customer, driver, customer, driver), stamped TODAY at
 * 10:08, 10:09, 10:10, 10:10 and 10:11 local time, so mock mode reproduces the
 * drawn screen, "Today" pill included.
 *
 * The conversation lives in a module-level map, so a message sent here is still
 * there after leaving and re-opening the screen (until the app restarts). The
 * list keeps INSERTION order: a message sent at 09:30 still goes to the end,
 * after the seeded 10:11, because that is the order it was sent in.
 *
 * The mock NEVER answers. Automatic driver replies are not designed, and a fake
 * driver typing back would be a behaviour nobody has approved.
 */

type SeedMessage = Pick<ChatMessage, 'sender' | 'text'> & { hour: number; minute: number };

/** Figma 22's five bubbles (`292:2658` … `292:2674`): sender, text, local time. */
const SEED: readonly SeedMessage[] = [
  { sender: 'driver', text: 'Hi, I am on my way. I will reach in 5 minutes.', hour: 10, minute: 8 },
  { sender: 'customer', text: 'Okay. I am waiting near the main gate.', hour: 10, minute: 9 },
  { sender: 'driver', text: 'Is the car in the basement or on the road?', hour: 10, minute: 10 },
  { sender: 'customer', text: 'On the road, next to the blue signboard.', hour: 10, minute: 10 },
  { sender: 'driver', text: 'Got it. See you soon.', hour: 10, minute: 11 },
];

const conversations = new Map<string, ChatMessage[]>();
let sentCount = 0;

/** The booking's conversation, seeded on first read with today's date. */
function conversation(bookingId: string): ChatMessage[] {
  let messages = conversations.get(bookingId);
  if (!messages) {
    const today = new Date();
    messages = SEED.map((seed, i) => ({
      id: `${bookingId}-seed-${i + 1}`,
      bookingId,
      sender: seed.sender,
      text: seed.text,
      sentAt: new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        seed.hour,
        seed.minute,
      ).toISOString(),
    }));
    conversations.set(bookingId, messages);
  }
  return messages;
}

export const chatMockSource: ChatDataSource = {
  async list(bookingId: string): Promise<ChatMessage[]> {
    await delay(300);
    // A copy, so the query cache never shares an array this module mutates.
    return [...conversation(bookingId)];
  },

  async send(bookingId: string, text: string): Promise<ChatMessage> {
    await delay(300);
    sentCount += 1;
    const message: ChatMessage = {
      id: `${bookingId}-sent-${sentCount}`,
      bookingId,
      sender: 'customer',
      text,
      sentAt: new Date().toISOString(),
    };
    conversation(bookingId).push(message);
    return message;
  },
};
