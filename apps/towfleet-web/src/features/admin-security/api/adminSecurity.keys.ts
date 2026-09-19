/**
 * W1's session-list keys. One key: the list is the caller's own sessions, and
 * the endpoint takes no parameters that could vary it.
 */
export const adminSecurityKeys = {
  sessions: () => ['admin-security', 'sessions'] as const,
};
