export const supportKeys = {
  all: ['support'] as const,
  list: () => ['support', 'list'] as const,
  detail: (ticketId: string) => ['support', 'detail', ticketId] as const,
};
