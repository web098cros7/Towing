export const adminDispatchKeys = {
  all: ['admin-dispatch'] as const,
  config: () => [...adminDispatchKeys.all, 'config'] as const,
  appConfig: () => [...adminDispatchKeys.all, 'app-config'] as const,
};
