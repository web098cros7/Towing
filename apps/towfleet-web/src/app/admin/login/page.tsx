'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { adminLoginRequestSchema } from '@towing/api-contracts';
import { Button, Field, Input } from '@towing/web-ui';
import { safeAdminNext } from '@/lib/adminNext';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import {
  AuthErrorBanner,
  AuthSuccess,
  ButtonSpinner,
  PasswordInput,
  useResendCooldown,
} from '@/components/auth/AuthFeedback';

// Local alias — keeps the JSX (`<SubmitSpinner />`) unambiguous next to the
// `submitting` flag it always pairs with.
const SubmitSpinner = ButtonSpinner;

type Step = 'credentials' | 'otp' | 'change' | 'success';

/** Beat between accepted credentials and the redirect — long enough to read. */
const SUCCESS_BEAT_MS = 650;

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
 *
 * Feedback contract matches the fleet login: banner for server failures,
 * per-field messages for validation, spinner + locked inputs in flight,
 * resend with cooldown, a Back link, and a success beat before leaving.
 * Labels and ids stay exactly as the admin specs assert them.
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
  const [banner, setBanner] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [otpError, setOtpError] = useState<string | undefined>(undefined);
  const [changeError, setChangeError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const { remaining: resendIn, start: startResendCooldown } = useResendCooldown();
  const beatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (beatTimer.current) clearTimeout(beatTimer.current);
    },
    [],
  );

  const land = async () => {
    // M0-F2: drop any cached identity (the login page fires no identity
    // query, so a stale `null` — or the PREVIOUS admin's identity — would
    // otherwise survive this client-side navigation).
    await queryClient.removeQueries({ queryKey: ['admin-identity'] });
    setStep('success');
    beatTimer.current = setTimeout(() => {
      router.replace(next);
      router.refresh();
    }, SUCCESS_BEAT_MS);
  };

  const issueChallenge = async (): Promise<{ id: string; method: 'sms' | 'totp' } | null> => {
    const parsed = adminLoginRequestSchema.safeParse({ email, password });
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
    const res = await fetch('/api/admin-session/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (!res.ok) {
      setBanner(await readErrorMessage(res, 'Sign-in failed. Please try again.'));
      return null;
    }
    const body = (await res.json()) as { challengeId: string; method?: 'sms' | 'totp' };
    return { id: body.challengeId, method: body.method === 'totp' ? 'totp' : 'sms' };
  };

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setBanner(null);
    setSubmitting(true);
    try {
      const challenge = await issueChallenge();
      if (!challenge) return;
      setChallengeId(challenge.id);
      setMethod(challenge.method);
      setOtp('');
      setOtpError(undefined);
      setStep('otp');
    } finally {
      setSubmitting(false);
    }
  };

  const resendCode = async () => {
    if (submitting || resendIn > 0 || method !== 'sms') return;
    setBanner(null);
    setSubmitting(true);
    try {
      const challenge = await issueChallenge();
      if (!challenge) {
        setStep('credentials');
        return;
      }
      setChallengeId(challenge.id);
      setMethod(challenge.method);
      startResendCooldown();
    } finally {
      setSubmitting(false);
    }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    // W2: six digits (SMS or authenticator) or an 8-character recovery code.
    if (!/^(\d{6}|[A-Za-z0-9_-]{8})$/.test(otp) || !challengeId) {
      setOtpError(method === 'totp' ? 'Enter the 6-digit code or a recovery code.' : 'Enter the 6-digit code.');
      return;
    }
    setOtpError(undefined);
    setBanner(null);
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
        // A wrong code is a field problem; anything else (expired challenge,
        // locked account) is a banner — the field hint would mislead.
        if (/code|otp|match|invalid|recover/i.test(message)) setOtpError(message);
        else setBanner(message);
        return;
      }
      await land();
    } finally {
      setSubmitting(false);
    }
  };

  const submitChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (newPassword !== confirmPassword) {
      setChangeError('The two passwords do not match.');
      return;
    }
    if (!/^(?=.*[A-Z])(?=.*\d).{8,128}$/.test(newPassword)) {
      setChangeError('At least 8 characters, with an uppercase letter and a digit.');
      return;
    }
    setChangeError(undefined);
    setBanner(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin-session/password/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, newPassword }),
      });
      if (!res.ok) {
        setBanner(await readErrorMessage(res, 'That password was not accepted.'));
        return;
      }
      await land();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthSplitLayout
      realm="admin"
      title="Welcome back"
      description="Sign in to the platform operations console."
    >
      {step === 'success' ? (
        <AuthSuccess title="Welcome back" message="Opening the console…" />
      ) : step === 'change' ? (
        <form onSubmit={submitChange} className="flex flex-col gap-4" noValidate>
          {banner ? <AuthErrorBanner message={banner} /> : null}
          <p className="text-sm text-text-secondary">
            Your password was reset. Choose a new one to finish signing in.
          </p>
          <Field label="New password" htmlFor="new-password" error={changeError}>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              value={newPassword}
              disabled={submitting}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setChangeError(undefined);
                setBanner(null);
              }}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm-password">
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              value={confirmPassword}
              disabled={submitting}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setChangeError(undefined);
                setBanner(null);
              }}
            />
          </Field>
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? (
              <>
                <SubmitSpinner /> Saving…
              </>
            ) : (
              'Set password and sign in'
            )}
          </Button>
        </form>
      ) : step === 'credentials' ? (
        <form onSubmit={submitCredentials} className="flex flex-col gap-4" noValidate>
          {banner ? <AuthErrorBanner message={banner} /> : null}
          <Field label="Email" htmlFor="email" error={emailError}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@towing.local"
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
                <SubmitSpinner /> Checking…
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
            {method === 'totp'
              ? 'Enter the code from your authenticator app — or a recovery code.'
              : 'We sent a 6-digit code to your registered mobile number.'}
          </p>
          <Field
            label={method === 'totp' ? 'Authenticator code' : 'One-time code'}
            htmlFor="otp"
            error={otpError}
          >
            <Input
              id="otp"
              inputMode={method === 'totp' ? 'text' : 'numeric'}
              maxLength={method === 'totp' ? 8 : 6}
              placeholder="000000"
              className="text-center text-lg font-bold tracking-[0.5em]"
              value={otp}
              disabled={submitting}
              onChange={(e) => {
                setOtp(
                  method === 'totp'
                    ? e.target.value.replace(/[^A-Za-z0-9_-]/g, '')
                    : e.target.value.replace(/\D/g, ''),
                );
                setOtpError(undefined);
                setBanner(null);
              }}
            />
          </Field>
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? (
              <>
                <SubmitSpinner /> Signing in…
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
            {method === 'sms' ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={submitting || resendIn > 0}
                onClick={resendCode}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </Button>
            ) : null}
          </div>
        </form>
      )}
    </AuthSplitLayout>
  );
}
