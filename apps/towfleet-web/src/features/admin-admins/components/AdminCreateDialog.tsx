'use client';

import { useState } from 'react';
import type { AdminCreateAdminResponse } from '@towing/api-contracts';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, Field, Input } from '@towing/web-ui';
import { useCreateAdmin } from '../api/adminAdmins.mutations';
import { ApiError } from '@/lib/apiClient';

/**
 * Super-admin admin creation (W2). The temporary password renders ONCE, in
 * this dialog, right after creation — the API never returns it again, and
 * neither does any other screen. Losing it means a reset, by design.
 */
export function AdminCreateDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateAdmin();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [subRole, setSubRole] = useState<'operations' | 'support' | 'finance'>('operations');
  const [receivesOpsAlerts, setReceivesOpsAlerts] = useState(false);
  const [result, setResult] = useState<AdminCreateAdminResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const created = await create.mutateAsync({ name, email, mobile, subRole, receivesOpsAlerts });
      setResult(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Creation failed. Please try again.');
    }
  };

  return (
    <Dialog open onClose={onClose} labelledBy="admin-create-title">
      <DialogHeader>
        <DialogTitle id="admin-create-title">{result ? 'Admin created' : 'Create admin'}</DialogTitle>
      </DialogHeader>
      {result ? (
        <>
          <DialogBody>
            <p className="text-sm text-text-secondary">
              Hand this password to {result.admin.name} out of band. It is shown once and never
              again — and they will choose their own on first sign-in.
            </p>
            <p
              data-testid="admin-temp-password"
              className="mt-3 rounded-lg bg-surface1 p-3 text-center font-mono text-lg font-bold tracking-wider"
            >
              {result.temporaryPassword}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </>
      ) : (
        <form onSubmit={submit}>
          <DialogBody>
            <div className="flex flex-col gap-4">
              <Field label="Name" htmlFor="admin-name" error={error ?? undefined}>
                <Input id="admin-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
              </Field>
              <Field label="Email" htmlFor="admin-email">
                <Input
                  id="admin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ops@towing.local"
                />
              </Field>
              <Field label="Mobile" htmlFor="admin-mobile">
                <Input
                  id="admin-mobile"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="+919845990005"
                />
              </Field>
              <Field label="Sub-role" htmlFor="admin-subrole">
                <select
                  id="admin-subrole"
                  value={subRole}
                  onChange={(e) => setSubRole(e.target.value as typeof subRole)}
                  className="w-full rounded-lg border border-border bg-surface0 px-3 py-2 text-sm"
                >
                  <option value="operations">Operations</option>
                  <option value="support">Support</option>
                  <option value="finance">Finance</option>
                </select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={receivesOpsAlerts}
                  onChange={(e) => setReceivesOpsAlerts(e.target.checked)}
                />
                Receives SOS / ops alerts
              </label>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
