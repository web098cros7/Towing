export const chatKeys = {
  all: ['chat'] as const,
  /** One booking's conversation with its driver (Figma 22). */
  messages: (bookingId: string) => ['chat', 'messages', bookingId] as const,
};
