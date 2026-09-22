export const quotesKeys = {
  all: ['quotes'] as const,
  list: () => [...quotesKeys.all, 'list'] as const,
};
