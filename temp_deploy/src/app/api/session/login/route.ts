import { NextResponse } from 'next/server';
import { ErrorCodes, fleetLoginRequestSchema } from '@towing/api-contracts';
import { env } from '@/lib/env';

/**
 * Step 1 of console login: credentials → challenge. Proxies the backend in
 * real mode; mock mode answers locally so the console demos with no backend
 * (and the Playwright smoke stays hermetic).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = fleetLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: ErrorCodes.VALIDATION_FAILED, message: 'Enter a valid email and password.' } },
      { status: 400 },
    );
  }

  if (env.useMocks) {
    return NextResponse.json({
      challengeId: '00000000-0000-4000-8000-000000000000',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  }

  const upstream = await fetch(`${env.apiBaseUrl}/v1/fleet/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  const payload: unknown = await upstream.json().catch(() => ({
    error: { code: ErrorCodes.INTERNAL, message: 'Sign-in service unavailable' },
  }));
  return NextResponse.json(payload, { status: upstream.status });
}
