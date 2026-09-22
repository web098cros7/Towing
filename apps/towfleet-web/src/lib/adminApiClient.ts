import { apiErrorSchema } from '@towing/api-contracts';
import { ApiError } from './apiClient';

/**
 * Fetch through the admin BFF proxy (`/api/admin-proxy/<path>` → `/v1/admin/<path>`).
 * Same shape as `apiFetch` (fleet); the only difference is the proxy path and
 * where a truly-expired session sends the browser.
 *
 * Central defaults (A3): a string body without an explicit content-type is
 * JSON, so callers must not set the header per call — and 204/empty bodies
 * resolve `undefined` instead of throwing inside `res.json()`.
 */
export async function adminApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  if (typeof init?.body === 'string' && !headers.has('content-type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`/api/admin-proxy/${path}`, {
    ...init,
    headers,
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    // Carry the current page as `?next=` (same as the identity provider and
    // the middleware) — but never bounce the login page off itself.
    const { pathname, search } = window.location;
    if (!pathname.startsWith('/admin/login')) {
      window.location.assign(`/admin/login?next=${encodeURIComponent(`${pathname}${search}`)}`);
    } else {
      window.location.assign('/admin/login');
    }
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

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
