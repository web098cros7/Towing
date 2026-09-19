import type { ChatMessage } from '../types';
import type { ChatDataSource } from './chatDataSource';

/**
 * The live side of the driver chat: there is NO chat API to call (22 spec, Data
 * gap 1). No endpoint, no contract, no socket event, and no chat in the driver app.
 *
 * The screen is not reachable with mocks off (`openDriverChat` opens the phone's
 * messages app instead), so this only matters if something opens 22 directly:
 * - `list` returns an empty conversation, which the screen draws as a white list;
 * - `send` REJECTS, loudly and by name, so a live build never looks like it sent
 *   a message nobody will receive.
 */
export const chatRestSource: ChatDataSource = {
  async list(): Promise<ChatMessage[]> {
    return [];
  },

  async send(): Promise<ChatMessage> {
    throw new Error('Chat with the driver is not available: the server has no chat API yet.');
  },
};
