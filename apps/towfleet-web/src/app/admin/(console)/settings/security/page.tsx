'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';
import { ApiError } from '@/lib/apiClient';
import {
  useConfirmTotp,
  useDisableTotp,
  useEnrollTotp,
  useRecoveryCodes,
} from '@/features/admin-security/api/adminSecurity.mutations';

/**
 * W2's two-factor settings (spec §9.4.1 "optional 2FA", G14 default).
 *
 * The flow mirrors the backend exactly: enrol returns an `otpauth://` URI the
 * WEB renders as a QR (the API never touches pixels), the admin proves
 * possession by typing one code, and only then is the factor enabled. Recovery
 * codes are issued separately and shown ONCE.
 *
 * G14 default is recorded here in the copy: TOTP is optional in W2 and becomes
 * required for super_admin and finance after M2 — no screen claims otherwise.
 */
export default function AdminSecurityPage() {
  const { admin } = useAdminIdentity();
  const enroll = useEnrollTotp();
  const confirm = useConfirmTotp();
  const disable = useDisableTotp();
  const recovery = useRecoveryCodes();

  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
    }
  };

  const enabled = admin?.twofaEnabled ?? false;

  return (
    <div>
      <PageHeader
        title="Security"
        description="Your second factor and recovery codes. These protect your own account only."
      />

      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            {enabled
              ? 'An authenticator app code is required every time you sign in.'
              : 'Add an authenticator app. Optional for now; required for super admins and finance after M2.'}
          </p>

          {error && <p className="text-sm text-error">{error}</p>}

          {enabled ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() =>
                    run(async () => {
                      const res = await recovery.mutateAsync();
                      setCodes(res.codes);
                    })
                  }
                  disabled={recovery.isPending}
                >
                  Issue recovery codes
                </Button>
              </div>
              {codes && (
                <div className="rounded-lg bg-surface1 p-3" data-testid="recovery-codes">
                  <p className="mb-2 text-xs text-text-secondary">
                    Shown once. Store them somewhere safe; each works a single time.
                  </p>
                  <div className="grid grid-cols-2 gap-1 font-mono text-sm">
                    {codes.map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                  </div>
                </div>
              )}
              <Field label="Reason for disabling" htmlFor="disable-reason">
                <Input
                  id="disable-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. lost authenticator device"
                />
              </Field>
              <Button
                variant="ghost"
                disabled={reason.trim().length < 5 || disable.isPending}
                onClick={() => run(() => disable.mutateAsync(reason))}
              >
                Disable two-factor
              </Button>
            </div>
          ) : uri ? (
            <div className="flex flex-col gap-3">
              <div className="w-fit rounded-lg bg-white p-3">
                <QRCodeSVG value={uri} size={160} />
              </div>
              <Field label="Enter the code your app shows" htmlFor="totp-code">
                <Input
                  id="totp-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                />
              </Field>
              <Button
                disabled={code.length !== 6 || confirm.isPending}
                onClick={() => run(() => confirm.mutateAsync(code))}
              >
                Confirm and enable
              </Button>
            </div>
          ) : (
            <Button
              onClick={() =>
                run(async () => {
                  const res = await enroll.mutateAsync();
                  setUri(res.otpauthUri);
                })
              }
              disabled={enroll.isPending}
            >
              Set up authenticator
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
