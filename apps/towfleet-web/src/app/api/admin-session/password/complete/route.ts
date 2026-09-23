import { NextResponse } from 'next/server';
import { ErrorCodes, adminCompletePasswordChangeSchema } from '@towing/api-contracts';
import { env } from '@/lib/env';
import { setAdminSessionCookies } from '@/lib/adminSession';

/**
 * W2's forced password change, step 2b of the login flow.
 *
 * The admin authenticated (password + second factor) but the account carries
 * `must_change_password` — `verify` refused to mint a session and left the
 * login challenge unconsumed for exactly this call. The challenge is the
 * authority, not a bearer token: at this point no session exists.
 *
 * Same cookie mechanics as `verify`: tokens land in httpOnly cookies and the
 * browser never holds one.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = adminCompletePasswordChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: ErrorCodes.VALIDATION_FAILED, message: 'Choose a stronger password.' } },
      { status: 400 },
    );
  }

  if (env.useMocks) {
    const response = NextResponse.json({
      admin: {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'ops@towing.local',
        name: 'Mock Admin',
        subRole: 'operations',
        twofaEnabled: false,
        twofaEnrolmentRequired: false,
      },
    });
    setAdminSessionCookies(response, {
      accessToken: 'mock-admin-session',
      refreshToken: 'mock-admin-refresh',
    });
    return response;
  }

  const upstream = await fetch(`${env.apiBaseUrl}/v1/admin/auth/password/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  const payload = (await upstream.json().catch(() => null)) as {
    accessToken?: string;
    refreshToken?: string;
    admin?: unknown;
    error?: unknown;
  } | null;

  if (!upstream.ok || !payload?.accessToken || !payload.refreshToken) {
    return NextResponse.json(
      payload ?? { error: { code: ErrorCodes.INTERNAL, message: 'Sign-in service unavailable' } },
      { status: upstream.ok ? 502 : upstream.status },
    );
  }

  const response = NextResponse.json({ admin: payload.admin });
  setAdminSessionCookies(response, {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
  });
  return response;
}
