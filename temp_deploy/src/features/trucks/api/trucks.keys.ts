export const trucksKeys = {
  all: ['trucks'] as const,
  list: () => [...trucksKeys.all, 'list'] as const,
};
