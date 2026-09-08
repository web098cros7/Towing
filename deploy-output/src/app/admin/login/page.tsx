'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminLoginRequestSchema } from '@towing/api-contracts';
import { Button, Card, CardContent, Field, Input } from '@towing/web-ui';

type Step = 'credentials' | 'otp';

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

/**
 * Admin console login (§9.4, §15.2) — same two-step shape as the fleet
 * console's login page, pointed at `/api/admin-session/*` instead.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = adminLoginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError('Enter a valid email and a password of at least 8 characters.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin-session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, 'Sign-in failed. Please try again.'));
        return;
      }
      const body = (await res.json()) as { challengeId: string };
      setChallengeId(body.challengeId);
      setOtp('');
      setStep('otp');
    } finally {
      setSubmitting(false);
    }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp) || !challengeId) {
      setError('Enter the 6-digit code.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin-session/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, otp }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, 'That code was not accepted.'));
        return;
      }
      router.replace('/admin/drivers');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface0 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-bold text-brand">Towing Admin</h1>
          <p className="mt-1 text-sm text-text-secondary">Platform operations console</p>
        </div>

        <Card>
          <CardContent className="p-6">
            {step === 'credentials' ? (
              <form onSubmit={submitCredentials} className="flex flex-col gap-4">
                <Field label="Email" htmlFor="email" error={error ?? undefined}>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@towing.local"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label="Password" htmlFor="password">
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Button type="submit" size="lg" className="mt-2" disabled={submitting}>
                  {submitting ? 'Checking…' : 'Continue'}
                </Button>
              </form>
            ) : (
              <form onSubmit={submitOtp} className="flex flex-col gap-4">
                <p className="text-sm text-text-secondary">
                  We sent a 6-digit code to your registered mobile number.
                </p>
                <Field label="One-time code" htmlFor="otp" error={error ?? undefined}>
                  <Input
                    id="otp"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    className="text-center text-lg tracking-[0.5em] font-bold"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
                <Button type="submit" size="lg" disabled={submitting}>
                  {submitting ? 'Signing in…' : 'Sign in'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => {
                    setError(null);
                    setStep('credentials');
                  }}
                >
                  Back
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
