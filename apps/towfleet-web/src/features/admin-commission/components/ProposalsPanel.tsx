'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, RelativeTime, Select } from '@towing/web-ui';
import type { AdminCommissionConfig, Band } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { useAdminCommissionProposals } from '../api/adminCommission.queries';
import {
  useApplyCommissionProposal,
  useCreateCommissionProposal,
  useDeclineCommissionProposal,
} from '../api/adminCommission.mutations';

/**
 * §4.2's Operations ⚠️, W11: OPERATIONS PROPOSES, FINANCE DECIDES.
 *
 * The split is structural, not cosmetic. A proposal is a row with a proposer
 * and a reason; applying it runs the proposal's band and percentage through the
 * ORDINARY commission write path, so a proposal can never become a rate that
 * skipped the guardrail — including one made before the window moved.
 *
 * One open proposal per band (the API answers 409), which is what keeps "apply"
 * unambiguous about which decision it is executing.
 */
export function ProposalsPanel({
  config,
  canPropose,
  canDecide,
}: {
  config: AdminCommissionConfig;
  canPropose: boolean;
  canDecide: boolean;
}) {
  const toast = useToast();
  const { data, isLoading } = useAdminCommissionProposals();
  const create = useCreateCommissionProposal();
  const apply = useApplyCommissionProposal();
  const decline = useDeclineCommissionProposal();

  const [band, setBand] = useState<Band>('A');
  const [pct, setPct] = useState('');
  const [reason, setReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pctValue = Number(pct);
  const withinWindow =
    Number.isFinite(pctValue) && pctValue >= config.floorPct && pctValue <= config.capPct;
  const canSubmit = canPropose && withinWindow && reason.trim().length >= 3 && !create.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    setErrorMessage(null);
    try {
      await create.mutateAsync({ band, pct: pctValue, reason: reason.trim() });
      setPct('');
      setReason('');
      toast('Proposal sent to Finance', 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const decide = async (id: string, decision: 'apply' | 'decline') => {
    setErrorMessage(null);
    try {
      if (decision === 'apply') {
        await apply.mutateAsync({ id, body: {} });
        toast('Proposal applied', 'success');
      } else {
        await decline.mutateAsync({ id, body: {} });
        toast('Proposal declined', 'info');
      }
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Proposals</CardTitle>
      </CardHeader>
      <CardContent>
        {canPropose ? (
          <>
            <p className="mb-3 text-sm text-text-secondary">
              A proposal moves nothing on its own. Finance applies it through the same write path as
              a direct edit, so the {config.floorPct}–{config.capPct} % window still decides.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Band" htmlFor="proposal-band">
                <Select
                  id="proposal-band"
                  value={band}
                  onChange={(event) => setBand(event.target.value as Band)}
                  data-testid="proposal-band"
                >
                  {config.bands.map((entry) => (
                    <option key={entry.band} value={entry.band}>
                      Band {entry.band} (now {entry.pct}%)
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Proposed (percent)" htmlFor="proposal-pct">
                <Input
                  id="proposal-pct"
                  inputMode="decimal"
                  value={pct}
                  onChange={(event) => setPct(event.target.value)}
                  data-testid="proposal-pct"
                />
              </Field>
              <Field label="Reason" htmlFor="proposal-reason">
                <Input
                  id="proposal-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  data-testid="proposal-reason"
                />
              </Field>
            </div>

            {pct !== '' && !withinWindow ? (
              <p className="mt-3 text-sm text-error" data-testid="proposal-window-error">
                Outside the live {config.floorPct}–{config.capPct} % window — a proposal has to be
                applyable as it stands.
              </p>
            ) : null}
            {errorMessage ? (
              <p className="mt-3 text-sm text-error" role="alert" data-testid="proposal-error">
                {errorMessage}
              </p>
            ) : null}

            <div className="mt-4">
              <Button
                variant="secondary"
                onClick={() => void submit()}
                disabled={!canSubmit}
                data-testid="proposal-submit"
              >
                {create.isPending ? 'Sending…' : 'Propose change'}
              </Button>
            </div>
          </>
        ) : null}

        {!canPropose ? (
          <p className="mb-3 text-sm text-text-secondary">
            Only Operations, Finance and super admins see this panel.
          </p>
        ) : null}

        <ul className="mt-4 space-y-2" data-testid="proposal-list">
          {(data ?? []).map((proposal) => (
            <li
              key={proposal.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border px-3 py-2"
              data-testid="proposal-row"
            >
              <div>
                <span className="text-sm font-semibold">
                  Band {proposal.band} → {proposal.pct}%
                </span>{' '}
                <Badge
                  variant={
                    proposal.status === 'open'
                      ? 'warning'
                      : proposal.status === 'applied'
                        ? 'success'
                        : 'neutral'
                  }
                  data-testid={`proposal-status-${proposal.status}`}
                >
                  {proposal.status}
                </Badge>
                <p className="mt-0.5 text-xs text-text-secondary">{proposal.reason}</p>
                <RelativeTime at={proposal.createdAt} className="text-xs text-text-tertiary" />
              </div>

              {proposal.status === 'open' && canDecide ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void decide(proposal.id, 'apply')}
                    data-testid={`proposal-apply-${proposal.id}`}
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void decide(proposal.id, 'decline')}
                    data-testid={`proposal-decline-${proposal.id}`}
                  >
                    Decline
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
          {!isLoading && (data ?? []).length === 0 ? (
            <li className="text-sm text-text-secondary">No proposals yet.</li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  );
}
