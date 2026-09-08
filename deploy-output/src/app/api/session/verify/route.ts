import { NextResponse } from 'next/server';
import { ErrorCodes, fleetOtpVerifyRequestSchema } from '@towing/api-contracts';
import { env } from '@/lib/env';
import { setSessionCookies } from '@/lib/session';

/**
 * Step 2: challenge + OTP → session. The tokens never reach the browser —
 * they land in httpOnly cookies the BFF proxy reads.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = fleetOtpVerifyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: ErrorCodes.VALIDATION_FAILED, message: 'Enter the 6-digit code.' } },
      { status: 400 },
    );
  }

  if (env.useMocks) {
    const response = NextResponse.json({
      fleet: { id: 'mock-fleet', businessName: 'Lakshmi Recovery Services' },
    });
    setSessionCookies(response, { accessToken: 'mock-session', refreshToken: 'mock-refresh' });
    return response;
  }

  const upstream = await fetch(`${env.apiBaseUrl}/v1/fleet/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  const payload = (await upstream.json().catch(() => null)) as {
    accessToken?: string;
    refreshToken?: string;
    fleet?: unknown;
    error?: unknown;
  } | null;

  if (!upstream.ok || !payload?.accessToken || !payload.refreshToken) {
    return NextResponse.json(
      payload ?? { error: { code: ErrorCodes.INTERNAL, message: 'Sign-in service unavailable' } },
      { status: upstream.ok ? 502 : upstream.status },
    );
  }

  // Tokens stay server-side; the client only learns who it signed in as.
  const response = NextResponse.json({ fleet: payload.fleet });
  setSessionCookies(response, {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
  });
  return response;
}
