import { NextResponse } from 'next/server';
import { ErrorCodes, adminLoginRequestSchema } from '@towing/api-contracts';
import { env } from '@/lib/env';

/**
 * Step 1 of admin login: email + password → OTP challenge. Same shape as
 * `/api/session/login` (fleet) — see that file for the mock-mode reasoning.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = adminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: ErrorCodes.VALIDATION_FAILED, message: 'Enter a valid email and password.' } },
      { status: 400 },
    );
  }

  if (env.useMocks) {
    return NextResponse.json({
      challengeId: '00000000-0000-4000-8000-000000000001',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  }

  const upstream = await fetch(`${env.apiBaseUrl}/v1/admin/auth/login`, {
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
