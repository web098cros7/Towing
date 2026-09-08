import { apiErrorSchema } from '@towing/api-contracts';

/** Typed failure carrying the backend's stable error code (spec §16). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Fetch through the BFF proxy (`/api/proxy/<path>` → `/v1/fleet/<path>`).
 * Auth is invisible here — the proxy injects it from httpOnly cookies and
 * transparently refreshes; a 401 that still gets through means the session is
 * truly gone, so the client goes back to login.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.assign('/login');
    throw new ApiError(401, 'unauthorized', 'Session expired');
  }

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiError(
        res.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
      );
    }
    throw new ApiError(res.status, 'internal_error', `Request failed (${res.status})`);
  }

  return (await res.json()) as T;
}
