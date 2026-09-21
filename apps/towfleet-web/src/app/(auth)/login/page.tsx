'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fleetLoginRequestSchema } from '@towing/api-contracts';
import { Button, Field, Input } from '@towing/web-ui';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import {
  AuthErrorBanner,
  AuthSuccess,
  ButtonSpinner,
  PasswordInput,
  useResendCooldown,
} from '@/components/auth/AuthFeedback';

type Step = 'credentials' | 'otp' | 'success';

/** Beat between accepted credentials and the redirect — long enough to read. */
const SUCCESS_BEAT_MS = 650;

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

/**
 * Email + password → OTP login (spec §9.3.1). One code path for mock and real
 * modes — the /api/session routes decide server-side. In dev the OTP is
 * printed in the backend log (DevOtpAdapter); in mock mode any 6 digits work.
 *
 * Feedback contract: banner for server failures, per-field messages for
 * validation, spinner + locked inputs in flight, resend with cooldown on the
 * OTP step, and a success beat before leaving. Labels and ids stay exactly as
 * the smoke spec asserts them.
 */
export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [otpError, setOtpError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const { remaining: resendIn, start: startResendCooldown } = useResendCooldown();
  const beatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (beatTimer.current) clearTimeout(beatTimer.current);
    },
    [],
  );

  const issueChallenge = async (): Promise<string | null> => {
    const parsed = fleetLoginRequestSchema.safeParse({ email, password });
    setEmailError(
      parsed.success || parsed.error.issues.some((i) => i.path.includes('email'))
        ? undefined
        : 'Enter a valid email address.',
    );
    setPasswordError(
      parsed.success || parsed.error.issues.some((i) => i.path.includes('password'))
        ? undefined
        : 'Password needs at least 8 characters.',
    );
    if (!parsed.success) return null;
    const res = await fetch('/api/session/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (!res.ok) {
      setBanner(await readErrorMessage(res, 'Sign-in failed. Please try again.'));
      return null;
    }
    const body = (await res.json()) as { challengeId: string };
    return body.challengeId;
  };

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setBanner(null);
    setSubmitting(true);
    try {
      const id = await issueChallenge();
      if (!id) return;
      setChallengeId(id);
      setOtp('');
      setOtpError(undefined);
      setStep('otp');
    } finally {
      setSubmitting(false);
    }
  };

  const resendCode = async () => {
    if (submitting || resendIn > 0) return;
    setBanner(null);
    setSubmitting(true);
    try {
      const id = await issueChallenge();
      if (!id) {
        // Credentials stopped validating (edited mid-step) — back to step 1
        // with the field errors visible rather than a dead resend button.
        setStep('credentials');
        return;
      }
      setChallengeId(id);
      startResendCooldown();
    } finally {
      setSubmitting(false);
    }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!/^\d{6}$/.test(otp) || !challengeId) {
      setOtpError('Enter the 6-digit code.');
      return;
    }
    setOtpError(undefined);
    setBanner(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/session/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, otp }),
      });
      if (!res.ok) {
        const message = await readErrorMessage(res, 'That code was not accepted.');
        // A wrong code is a field problem; anything else (expired challenge,
        // locked account) is a banner — the field hint would mislead.
        if (/code|otp|match|invalid/i.test(message)) setOtpError(message);
        else setBanner(message);
        return;
      }
      setStep('success');
      beatTimer.current = setTimeout(() => {
        router.replace('/');
        router.refresh();
      }, SUCCESS_BEAT_MS);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthSplitLayout
      realm="fleet"
      title="Welcome back"
      description="Sign in to your fleet console."
    >
      {step === 'success' ? (
        <AuthSuccess title="Welcome back" message="Opening your dashboard…" />
      ) : step === 'credentials' ? (
        <form onSubmit={submitCredentials} className="flex flex-col gap-4" noValidate>
          {banner ? <AuthErrorBanner message={banner} /> : null}
          <Field label="Email" htmlFor="email" error={emailError}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@business.in"
              value={email}
              disabled={submitting}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError(undefined);
                setBanner(null);
              }}
            />
          </Field>
          <Field label="Password" htmlFor="password" error={passwordError}>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              disabled={submitting}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(undefined);
                setBanner(null);
              }}
            />
          </Field>
          <Button type="submit" size="lg" className="mt-2" disabled={submitting}>
            {submitting ? (
              <>
                <ButtonSpinner /> Checking…
              </>
            ) : (
              'Continue'
            )}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitOtp} className="flex flex-col gap-4" noValidate>
          {banner ? <AuthErrorBanner message={banner} /> : null}
          <p className="text-sm text-text-secondary">
            We sent a 6-digit code to your registered mobile number.
          </p>
          <Field label="One-time code" htmlFor="otp" error={otpError}>
            <Input
              id="otp"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              className="text-center text-lg font-bold tracking-[0.5em]"
              value={otp}
              disabled={submitting}
              onChange={(e) => {
                setOtp(e.target.value.replace(/\D/g, ''));
                setOtpError(undefined);
                setBanner(null);
              }}
            />
          </Field>
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? (
              <>
                <ButtonSpinner /> Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </Button>
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              disabled={submitting}
              onClick={() => {
                setBanner(null);
                setOtpError(undefined);
                setStep('credentials');
              }}
            >
              Back
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={submitting || resendIn > 0}
              onClick={resendCode}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </Button>
          </div>
        </form>
      )}
    </AuthSplitLayout>
  );
}
