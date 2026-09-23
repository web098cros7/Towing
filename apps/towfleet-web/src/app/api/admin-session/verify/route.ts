import { NextResponse } from 'next/server';
import { ErrorCodes, adminOtpVerifyRequestSchema } from '@towing/api-contracts';
import { env } from '@/lib/env';
import { setAdminSessionCookies } from '@/lib/adminSession';

/** Step 2: challenge + OTP → session. Tokens land in httpOnly cookies, never the browser. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = adminOtpVerifyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: ErrorCodes.VALIDATION_FAILED, message: 'Enter the 6-digit code.' } },
      { status: 400 },
    );
  }

  if (env.useMocks) {
    const response = NextResponse.json({
      admin: {
        // A fixed UUID, not a bare string: the client parses this against
        // `adminIdentitySchema`, and mocks must satisfy the contract they
        // stand in for (A7 caught `id: 'mock-admin'` failing `z.uuid()`).
        id: '00000000-0000-4000-8000-000000000001',
        email: 'ops@towing.local',
        name: 'Mock Admin',
        subRole: 'operations',
        twofaEnabled: false,
        twofaEnrolmentRequired: false,
      },
    });
    setAdminSessionCookies(response, { accessToken: 'mock-admin-session', refreshToken: 'mock-admin-refresh' });
    return response;
  }

  const upstream = await fetch(`${env.apiBaseUrl}/v1/admin/auth/verify`, {
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
