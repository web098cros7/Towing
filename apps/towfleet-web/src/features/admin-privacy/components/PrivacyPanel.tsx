'use client';

import { useState } from 'react';
import type {
  AdminDeletionRequest,
  AdminDeletionRequestsQuery,
  AdminRetentionPolicy,
  DeletionRequestStatus,
} from '@towing/api-contracts';
import {
  Badge,
  Button,
  Card,
  RelativeTime,
  Select,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from '@towing/web-ui';
import { Drawer, DrawerBody, DrawerFooter, DrawerHeader, DrawerTitle } from '@towing/web-ui';
import { useAdminCan } from '@/components/admin/Can';
import { useToast } from '@/components/admin/ToastProvider';
import {
  useDecideDeletionRequest,
  useDeletionRequest,
  useDeletionRequests,
  useExecuteDeletionRequest,
  useHoldDeletionRequest,
  useRetentionPolicies,
  useUpdateRetention,
} from '../api/adminPrivacy.queries';

type RequestStatus = DeletionRequestStatus;

const STATUS_TONE: Record<RequestStatus, 'neutral' | 'info' | 'success' | 'error' | 'warning'> = {
  requested: 'info',
  on_hold: 'warning',
  approved: 'info',
  executing: 'info',
  completed: 'success',
  rejected: 'neutral',
};

/**
 * W19's privacy console (§20.4 DPDP), `/admin/privacy`.
 *
 * TWO TABS, ONE OBLIGATION EACH. The queue is the workflow (approve, hold,
 * execute) and the retention tab is the schedule the nightly sweep reads —
 * both live on this page because "what we deleted for this person" and "how
 * long we keep things in general" are the two questions a DPDP review asks.
 *
 * THE EXECUTE BUTTON IS TYPED-CONFIRMED. It is the one irreversible action in
 * the console: an erasure cannot be undone, so the button stays disabled until
 * the operator types the word — a confirm() dialog trains people to click
 * through it.
 */
export function PrivacyPanel() {
  const [tab, setTab] = useState<'queue' | 'retention'>('queue');
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-4" data-testid="privacy-panel">
      <Tabs
        value={tab}
        onChange={(value) => setTab(value)}
        aria-label="Privacy sections"
        items={[
          { value: 'queue', label: 'Deletion queue' },
          { value: 'retention', label: 'Retention' },
        ]}
      />

      {tab === 'queue' ? <QueueTab onOpen={setOpenId} /> : <RetentionTab />}

      <RequestDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function QueueTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<'' | RequestStatus>('');
  const [subjectType, setSubjectType] = useState<'' | 'user' | 'driver'>('');

  const query: AdminDeletionRequestsQuery = {
    page: 1,
    limit: 25,
    ...(status ? { status } : {}),
    ...(subjectType ? { subjectType } : {}),
  };
  const requests = useDeletionRequests(query);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm font-semibold">
          <span>Status</span>
          <Select
            data-testid="queue-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as '' | RequestStatus)}
          >
            <option value="">All</option>
            <option value="requested">Requested</option>
            <option value="on_hold">On hold</option>
            <option value="approved">Approved</option>
            <option value="executing">Executing</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </Select>
        </label>
        <label className="space-y-1 text-sm font-semibold">
          <span>Subject</span>
          <Select
            data-testid="queue-subject"
            value={subjectType}
            onChange={(event) => setSubjectType(event.target.value as '' | 'user' | 'driver')}
          >
            <option value="">All</option>
            <option value="user">Customers</option>
            <option value="driver">Drivers</option>
          </Select>
        </label>
      </div>

      {requests.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : requests.data && requests.data.items.length > 0 ? (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Hold / reason</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.data.items.map((request) => (
                <TableRow key={request.id} data-testid="request-row">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{request.subjectLabel ?? 'Anonymised'}</span>
                      <Badge variant="neutral">
                        {request.subjectType === 'driver' ? 'driver' : 'customer'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      status={request.status}
                      tone={STATUS_TONE[request.status]}
                      data-testid="request-status"
                    />
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    <RelativeTime at={request.requestedAt} />
                  </TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {request.holdReason ? (
                      <span className="font-mono text-xs" data-testid="request-hold-reason">
                        {request.holdReason}
                      </span>
                    ) : (
                      (request.reason ?? '—')
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="secondary"
                      data-testid="request-open"
                      onClick={() => onOpen(request.id)}
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card className="p-6 text-sm text-text-secondary" data-testid="queue-empty">
          No deletion requests match.
        </Card>
      )}
    </div>
  );
}

function RequestDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast();
  const detail = useDeletionRequest(id);
  const decide = useDecideDeletionRequest();
  const hold = useHoldDeletionRequest();
  const execute = useExecuteDeletionRequest();

  const [holdReason, setHoldReason] = useState('');
  const [confirmText, setConfirmText] = useState('');

  const request = detail.data ?? null;
  const decided = request !== null && ['rejected', 'completed', 'executing'].includes(request.status);
  const approved = request?.status === 'approved';

  const close = () => {
    setHoldReason('');
    setConfirmText('');
    onClose();
  };

  const run = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast(message, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The action failed.', 'error');
    }
  };

  return (
    <Drawer open={id !== null} onClose={close} labelledBy="privacy-drawer-title">
      <DrawerHeader>
        <DrawerTitle id="privacy-drawer-title">Deletion request</DrawerTitle>
      </DrawerHeader>
      <DrawerBody className="space-y-4">
        {!request ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-text-secondary">Subject</dt>
                <dd data-testid="drawer-subject">{request.subjectLabel ?? 'Anonymised'}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Status</dt>
                <dd>
                  <StatusChip status={request.status} tone={STATUS_TONE[request.status]} />
                </dd>
              </div>
              <div>
                <dt className="text-text-secondary">Requested</dt>
                <dd>{new Date(request.requestedAt).toLocaleString('en-IN')}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Their reason</dt>
                <dd>{request.reason ?? '—'}</dd>
              </div>
            </dl>

            {request.holdReason ? (
              <div
                className="rounded-card border border-warning-soft-fg/40 p-3 text-sm"
                data-testid="drawer-hold-reason"
              >
                On hold: <span className="font-mono text-xs">{request.holdReason}</span>
              </div>
            ) : null}

            {request.latestJob ? (
              <section className="space-y-2" data-testid="drawer-job">
                <h3 className="text-sm font-semibold">
                  Erasure log{' '}
                  <span className="font-normal text-text-secondary">({request.latestJob.status})</span>
                </h3>
                <ol className="space-y-1 text-sm">
                  {request.latestJob.steps.map((step) => (
                    <li key={`${step.step}-${step.at}`} className="flex items-start gap-2" data-testid="step-row">
                      <Badge
                        variant={
                          step.outcome === 'done'
                            ? 'success'
                            : step.outcome === 'refused'
                              ? 'error'
                              : 'neutral'
                        }
                      >
                        {step.outcome}
                      </Badge>
                      <span className="font-mono text-xs">{step.step}</span>
                      <span className="text-text-secondary">
                        {step.count > 0 ? `${step.count} · ` : ''}
                        {step.detail ?? ''}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {['requested', 'on_hold', 'approved'].includes(request.status) ? (
              <section className="space-y-3" data-testid="drawer-actions">
                <div className="flex gap-2">
                  <Button
                    data-testid="approve"
                    disabled={decided}
                    onClick={() =>
                      void run(() => decide.mutateAsync({ id: request.id, decision: 'approve', body: {} }), 'Request approved.')
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    data-testid="reject"
                    disabled={decided}
                    onClick={() =>
                      void run(() => decide.mutateAsync({ id: request.id, decision: 'reject', body: {} }), 'Request rejected.')
                    }
                  >
                    Reject
                  </Button>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold" htmlFor="hold-reason">
                    Hold with a reason
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="hold-reason"
                      data-testid="hold-reason-input"
                      className="w-full rounded-card border border-border bg-surface px-3 py-2 text-sm"
                      value={holdReason}
                      onChange={(event) => setHoldReason(event.target.value)}
                      placeholder="Why can this not run yet?"
                    />
                    <Button
                      variant="secondary"
                      data-testid="hold"
                      disabled={holdReason.trim().length < 3}
                      onClick={() =>
                        void run(
                          () => hold.mutateAsync({ id: request.id, body: { reason: holdReason.trim() } }),
                          'Request parked on hold.',
                        )
                      }
                    >
                      Hold
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold" htmlFor="execute-confirm">
                    Execute (type DELETE to confirm)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="execute-confirm"
                      data-testid="execute-confirm"
                      className="w-full rounded-card border border-border bg-surface px-3 py-2 font-mono text-sm"
                      value={confirmText}
                      onChange={(event) => setConfirmText(event.target.value)}
                      placeholder="DELETE"
                    />
                    <Button
                      variant="destructive"
                      data-testid="execute"
                      disabled={!approved || confirmText !== 'DELETE' || execute.isPending}
                      onClick={() =>
                        void run(() => execute.mutateAsync(request.id), 'Erasure queued.')
                      }
                    >
                      Execute
                    </Button>
                  </div>
                  {!approved ? (
                    <p className="text-xs text-text-secondary" data-testid="execute-guard">
                      Approve the request first — executing skips the two-person check.
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}
          </>
        )}
      </DrawerBody>
      <DrawerFooter>
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}

function RetentionTab() {
  const toast = useToast();
  const can = useAdminCan();
  const canEdit = can('admin.manage');
  const policies = useRetentionPolicies();
  const update = useUpdateRetention();
  const [draft, setDraft] = useState<Record<string, number>>({});

  const items: AdminRetentionPolicy[] = policies.data?.items ?? [];
  const days = (policy: AdminRetentionPolicy) => draft[policy.policyKey] ?? policy.retentionDays;

  const save = async () => {
    const changed = items
      .filter((policy) => draft[policy.policyKey] !== undefined && draft[policy.policyKey] !== policy.retentionDays)
      .map((policy) => ({ policyKey: policy.policyKey, retentionDays: days(policy) }));
    if (changed.length === 0) {
      toast('Nothing changed.', 'info');
      return;
    }
    try {
      await update.mutateAsync({ policies: changed });
      setDraft({});
      toast('Retention updated — the sweep picks it up tonight.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save.', 'error');
    }
  };

  if (policies.isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <Card className="overflow-hidden" data-testid="retention-tab">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Policy</TableHead>
            <TableHead>Kept for (days)</TableHead>
            <TableHead>Enforcement</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((policy) => (
            <TableRow key={policy.policyKey} data-testid="policy-row">
              <TableCell>
                <div className="font-mono text-xs">{policy.policyKey}</div>
                <div className="text-xs text-text-secondary">{policy.description}</div>
              </TableCell>
              <TableCell>
                <input
                  type="number"
                  min={1}
                  data-testid={`policy-days-${policy.policyKey}`}
                  className="w-28 rounded-card border border-border bg-surface px-2 py-1 text-sm"
                  value={days(policy)}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [policy.policyKey]: Number(event.target.value),
                    }))
                  }
                />
              </TableCell>
              <TableCell>
                {policy.enforced ? (
                  <Badge variant="success" data-testid="policy-enforced">
                    swept nightly
                  </Badge>
                ) : (
                  <Badge variant="neutral" data-testid="policy-policy-only">
                    policy only
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-end gap-3 border-t border-border p-4">
        {canEdit ? null : (
          <span className="text-xs text-text-secondary" data-testid="retention-guard">
            Super admin only.
          </span>
        )}
        <Button data-testid="retention-save" disabled={!canEdit || update.isPending} onClick={() => void save()}>
          Save retention
        </Button>
      </div>
    </Card>
  );
}
