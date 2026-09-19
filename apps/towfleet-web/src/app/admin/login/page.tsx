'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { adminLoginRequestSchema } from '@towing/api-contracts';
import { Button, Card, CardContent, Field, Input } from '@towing/web-ui';
import { safeAdminNext } from '@/lib/adminNext';

type Step = 'credentials' | 'otp' | 'change';

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

/** W2: the OTP step branches on the error CODE, so the body is read once. */
async function readError(res: Response, fallback: string): Promise<{ code?: string; message: string }> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  return { code: body?.error?.code, message: body?.error?.message ?? fallback };
}

/**
 * Admin console login (§9.4, §15.2) — same two-step shape as the fleet
 * console's login page, pointed at `/api/admin-session/*` instead.
 *
 * Split for `useSearchParams()`: Next 15 requires a Suspense boundary above
 * any component reading search params during prerendering. The `?next=`
 * sanitiser lives in `@/lib/adminNext` — a page may only export the route
 * itself, so the helper cannot live here.
 */
export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginForm />
    </Suspense>
  );
}

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const next = safeAdminNext(searchParams.get('next'));
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  // W2: the challenge says which second factor it expects. SMS (the default)
  // shows "we sent a code"; TOTP (an enrolled authenticator) shows "enter your
  // authenticator code" and no SMS is ever sent. The same input accepts an
  // 8-character recovery code, so recovery needs no second screen.
  const [method, setMethod] = useState<'sms' | 'totp'>('sms');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
      const body = (await res.json()) as { challengeId: string; method?: 'sms' | 'totp' };
      setChallengeId(body.challengeId);
      setMethod(body.method === 'totp' ? 'totp' : 'sms');
      setOtp('');
      setStep('otp');
    } finally {
      setSubmitting(false);
    }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    // W2: six digits (SMS or authenticator) or an 8-character recovery code.
    if (!/^(\d{6}|[A-Za-z0-9_-]{8})$/.test(otp) || !challengeId) {
      setError(method === 'totp' ? 'Enter the 6-digit code or a recovery code.' : 'Enter the 6-digit code.');
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
        const { code, message } = await readError(res, 'That code was not accepted.');
        // W2: a temporary password from a reset never mints a session. The
        // challenge stays live server-side, so the SAME page completes the
        // change without a second login.
        if (code === 'password_change_required') {
          setStep('change');
          return;
        }
        setError(message);
        return;
      }
      // M0-F2: drop any cached identity (the login page fires no identity
      // query, so a stale `null` — or the PREVIOUS admin's identity — would
      // otherwise survive this client-side navigation).
      await queryClient.removeQueries({ queryKey: ['admin-identity'] });
      router.replace(next);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const submitChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    if (!/^(?=.*[A-Z])(?=.*\d).{8,128}$/.test(newPassword)) {
      setError('At least 8 characters, with an uppercase letter and a digit.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin-session/password/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, newPassword }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, 'That password was not accepted.'));
        return;
      }
      await queryClient.removeQueries({ queryKey: ['admin-identity'] });
      router.replace(next);
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
            {step === 'change' ? (
              <form onSubmit={submitChange} className="flex flex-col gap-4">
                <p className="text-sm text-text-secondary">
                  Your password was reset. Choose a new one to finish signing in.
                </p>
                <Field label="New password" htmlFor="new-password" error={error ?? undefined}>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </Field>
                <Field label="Confirm new password" htmlFor="confirm-password">
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </Field>
                <Button type="submit" size="lg" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Set password and sign in'}
                </Button>
              </form>
            ) : step === 'credentials' ? (
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
                  {method === 'totp'
                    ? 'Enter the code from your authenticator app — or a recovery code.'
                    : 'We sent a 6-digit code to your registered mobile number.'}
                </p>
                <Field
                  label={method === 'totp' ? 'Authenticator code' : 'One-time code'}
                  htmlFor="otp"
                  error={error ?? undefined}
                >
                  <Input
                    id="otp"
                    inputMode={method === 'totp' ? 'text' : 'numeric'}
                    maxLength={method === 'totp' ? 8 : 6}
                    placeholder={method === 'totp' ? '000000' : '000000'}
                    className="text-center text-lg tracking-[0.5em] font-bold"
                    value={otp}
                    onChange={(e) =>
                      setOtp(
                        method === 'totp'
                          ? e.target.value.replace(/[^A-Za-z0-9_-]/g, '')
                          : e.target.value.replace(/\D/g, ''),
                      )
                    }
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
