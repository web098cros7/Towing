'use client';

import { useState } from 'react';
import type { AdminAdminListItem } from '@towing/api-contracts';
import { Badge, Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, Field, Input } from '@towing/web-ui';
import {
  useDeactivateAdmin,
  useReactivateAdmin,
  useResetAdminPassword,
  useUpdateAdmin,
} from '../api/adminAdmins.mutations';
import { ApiError } from '@/lib/apiClient';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  operations: 'Operations',
  support: 'Support',
  finance: 'Finance',
};

/**
 * One admin's detail + the super-admin levers (W2): role change, deactivate /
 * reactivate, password reset. Every destructive write takes a REASON — the
 * API requires it for the audit row, and the button stays disabled without
 * one, so the 422 is never the operator's first encounter with the rule.
 *
 * The reset password renders once, like creation. Deactivating the last
 * super_admin 409s with an explanation rather than stranding the platform.
 */
export function AdminDetailDialog({
  admin,
  onClose,
}: {
  admin: AdminAdminListItem;
  onClose: () => void;
}) {
  const update = useUpdateAdmin();
  const deactivate = useDeactivateAdmin();
  const reactivate = useReactivateAdmin();
  const reset = useResetAdminPassword();

  const [subRole, setSubRole] = useState(admin.subRole);
  const [receivesOpsAlerts, setReceivesOpsAlerts] = useState(admin.receivesOpsAlerts);
  const [reason, setReason] = useState('');
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = update.isPending || deactivate.isPending || reactivate.isPending || reset.isPending;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
    }
  };

  const reasonOk = reason.trim().length >= 5;

  return (
    <Dialog open onClose={onClose} labelledBy="admin-detail-title">
      <DialogHeader>
        <DialogTitle id="admin-detail-title">{admin.name}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <span>{admin.email}</span>
            <Badge variant={admin.status === 'active' ? 'success' : 'warning'}>
              {admin.status === 'active' ? 'Active' : 'Suspended'}
            </Badge>
            {admin.twofaEnabled && <Badge variant="neutral">2FA on</Badge>}
          </div>

          {tempPassword ? (
            <div>
              <p className="text-sm text-text-secondary">
                Hand this password over out of band. It is shown once — and they must choose
                their own on first sign-in.
              </p>
              <p
                data-testid="admin-temp-password"
                className="mt-2 rounded-lg bg-surface1 p-3 text-center font-mono text-lg font-bold tracking-wider"
              >
                {tempPassword}
              </p>
            </div>
          ) : (
            <>
              <div className="flex gap-3">
                <Field label="Sub-role" htmlFor="admin-detail-subrole">
                  <select
                    id="admin-detail-subrole"
                    value={subRole}
                    onChange={(e) => setSubRole(e.target.value as typeof subRole)}
                    className="w-full rounded-lg border border-border bg-surface0 px-3 py-2 text-sm"
                  >
                    <option value="super_admin">Super admin</option>
                    <option value="operations">Operations</option>
                    <option value="support">Support</option>
                    <option value="finance">Finance</option>
                  </select>
                </Field>
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={receivesOpsAlerts}
                    onChange={(e) => setReceivesOpsAlerts(e.target.checked)}
                  />
                  Ops alerts
                </label>
              </div>

              <Field
                label="Reason (goes into the audit trail)"
                htmlFor="admin-detail-reason"
                error={error ?? undefined}
              >
                <Input
                  id="admin-detail-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is this changing?"
                />
              </Field>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy || !reasonOk}
                  onClick={() =>
                    run(() => update.mutateAsync({ id: admin.id, body: { subRole, receivesOpsAlerts, reason } }))
                  }
                >
                  Save changes
                </Button>
                {admin.status === 'active' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !reasonOk}
                    onClick={() => run(() => deactivate.mutateAsync({ id: admin.id, body: { reason } }))}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !reasonOk}
                    onClick={() => run(() => reactivate.mutateAsync({ id: admin.id, body: { reason } }))}
                  >
                    Reactivate
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const res = await reset.mutateAsync(admin.id);
                      setTempPassword(res.temporaryPassword);
                    })
                  }
                >
                  Reset password
                </Button>
              </div>
              <p className="text-xs text-text-tertiary">
                Role changes and deactivation revoke every session immediately. {ROLE_LABEL[admin.subRole]}{' '}
                account, last sign-in{' '}
                {admin.lastLoginAt
                  ? new Date(admin.lastLoginAt).toLocaleString('en-IN', { dateStyle: 'medium' })
                  : 'never'}
                .
              </p>
            </>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
