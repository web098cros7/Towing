import { apiErrorSchema } from '@towing/api-contracts';
import { ApiError } from './apiClient';

/**
 * Fetch through the admin BFF proxy (`/api/admin-proxy/<path>` → `/v1/admin/<path>`).
 * Same shape as `apiFetch` (fleet); the only difference is the proxy path and
 * where a truly-expired session sends the browser.
 */
export async function adminApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin-proxy/${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.assign('/admin/login');
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
