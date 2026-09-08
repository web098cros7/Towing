'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Badge, Button, Card, CardContent, Field, Input, cn } from '@towing/web-ui';
import { env } from '@/lib/env';
import { useUploadComplianceDoc } from '../api/trucks.mutations';
import {
  DOC_TYPE_LABEL,
  TRUCK_TYPE_LABEL,
  type ComplianceDoc,
  type ComplianceDocType,
  type Truck,
} from '../types';

function daysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
}

function DocRow({ doc }: { doc: ComplianceDoc }) {
  const left = daysLeft(doc.expiresAt);
  return (
    <div className="flex items-center justify-between border-b border-border py-3 last:border-0">
      <div>
        <div className="text-sm font-medium">{DOC_TYPE_LABEL[doc.docType]}</div>
        <div className="text-xs text-text-secondary">
          {doc.expiresAt
            ? `Expires ${new Date(doc.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
            : 'Not uploaded'}
        </div>
      </div>
      {doc.status === 'valid' ? (
        <Badge variant="success">Valid</Badge>
      ) : doc.status === 'expiring' ? (
        <Badge variant="warning">{left} days left</Badge>
      ) : doc.status === 'expired' ? (
        <Badge variant="error">Expired</Badge>
      ) : (
        <Badge variant="neutral">Missing</Badge>
      )}
    </div>
  );
}

/** Compliance checklist drawer (spec §9.3.4) — uploads go live in Phase 4/6. */
export function ComplianceDrawer({ truck, onClose }: { truck: Truck; onClose: () => void }) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-card p-6 shadow-xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-display text-xl font-bold">{truck.plate}</h2>
          <p className="text-sm text-text-secondary">
            {TRUCK_TYPE_LABEL[truck.type]} · {truck.capacityTons}t ·{' '}
            {truck.assignedDriverName ?? 'Unassigned'}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close drawer">
          <X className="size-4" />
        </Button>
      </div>

      {truck.status === 'non_compliant' ? (
        <Card className="mb-4 border-error-soft-bg bg-error-soft-bg/40">
          <CardContent className="p-3 text-sm text-error-soft-fg">
            This truck is excluded from dispatch until expired documents are renewed.
          </CardContent>
        </Card>
      ) : null}

      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Compliance checklist
      </h3>
      <div className="flex-1 overflow-y-auto">
        {truck.compliance.map((doc) => (
          <DocRow key={doc.id} doc={doc} />
        ))}
      </div>

      {env.useMocks ? (
        <Button className="mt-4" disabled title="Uploads need the real backend (mocks are on)">
          Upload document
        </Button>
      ) : (
        <UploadForm truckId={truck.id} />
      )}
    </aside>
  );
}

const DOC_TYPES: ComplianceDocType[] = ['insurance', 'rc', 'puc', 'permit'];

/** Renew/upload a document — metadata drives compliance; the file is optional. */
function UploadForm({ truckId }: { truckId: string }) {
  const upload = useUploadComplianceDoc();
  const [docType, setDocType] = useState<ComplianceDocType>('insurance');
  const [expiresAt, setExpiresAt] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expiresAt) return;
    upload.mutate(
      { truckId, docType, expiresAt: new Date(expiresAt).toISOString(), file },
      { onSuccess: () => setFile(null) },
    );
  };

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap gap-1">
        {DOC_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setDocType(t)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              docType === t
                ? 'bg-brand text-on-brand'
                : 'bg-surface1 text-text-secondary hover:text-text-primary',
            )}
          >
            {DOC_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <Field label="Valid until" htmlFor="doc-expiry">
        <Input
          id="doc-expiry"
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          required
        />
      </Field>
      <Field label="Document (optional)" htmlFor="doc-file">
        <Input
          id="doc-file"
          type="file"
          accept=".pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="h-auto py-1.5"
        />
      </Field>
      {upload.isError ? (
        <p className="text-xs text-error">{(upload.error as Error).message}</p>
      ) : null}
      {upload.isSuccess ? (
        <p className="text-xs text-success-soft-fg">Document saved — checklist updated.</p>
      ) : null}
      <Button type="submit" disabled={upload.isPending || !expiresAt}>
        {upload.isPending ? 'Saving…' : 'Save document'}
      </Button>
    </form>
  );
}
