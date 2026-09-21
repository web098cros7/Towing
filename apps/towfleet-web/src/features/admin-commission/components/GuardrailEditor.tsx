'use client';

import { useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@towing/web-ui';
import type { AdminCommissionConfig } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { useUpdateCommissionGuardrail } from '../api/adminCommission.mutations';

/**
 * Decision G2 — the §3.3 window itself, `commission.guardrail`, super admin only.
 *
 * THE OUTER BOUND IS 0 < pct ≤ 30, and the database refuses anything past it.
 * Within that, the window is a business setting: a super admin may move it, and
 * the service refuses a window that would leave a LIVE band outside it — a
 * policy that excludes what the platform is charging right now is a
 * contradiction, not a policy.
 */
export function GuardrailEditor({ config }: { config: AdminCommissionConfig }) {
  const toast = useToast();
  const update = useUpdateCommissionGuardrail();
  const [floor, setFloor] = useState(String(config.floorPct));
  const [cap, setCap] = useState(String(config.capPct));
  const [reason, setReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setFloor(String(config.floorPct));
    setCap(String(config.capPct));
  }, [config]);

  const floorValue = Number(floor);
  const capValue = Number(cap);
  const boundsValid =
    Number.isFinite(floorValue) &&
    Number.isFinite(capValue) &&
    floorValue > 0 &&
    capValue <= 30 &&
    floorValue < capValue;

  const stranded = config.bands.filter(
    (band) => boundsValid && (band.pct < floorValue || band.pct > capValue),
  );

  const canSave = boundsValid && stranded.length === 0 && !update.isPending;

  const save = async () => {
    if (!canSave) return;
    setErrorMessage(null);
    try {
      await update.mutateAsync({
        floorPct: floorValue,
        capPct: capValue,
        reason: reason || undefined,
      });
      setReason('');
      toast('Guardrail updated', 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Guardrail (super admin)</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-text-secondary">
          The hard ceiling is 30 %; the database refuses more, whatever this page says.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Floor (percent)" htmlFor="guardrail-floor">
            <Input
              id="guardrail-floor"
              inputMode="decimal"
              value={floor}
              onChange={(event) => setFloor(event.target.value)}
              data-testid="guardrail-floor"
            />
          </Field>
          <Field label="Cap (percent)" htmlFor="guardrail-cap">
            <Input
              id="guardrail-cap"
              inputMode="decimal"
              value={cap}
              onChange={(event) => setCap(event.target.value)}
              data-testid="guardrail-cap"
            />
          </Field>
          <Field label="Reason" htmlFor="guardrail-reason">
            <Input
              id="guardrail-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              data-testid="guardrail-reason"
            />
          </Field>
        </div>

        {!boundsValid ? (
          <p className="mt-3 text-sm text-error" data-testid="guardrail-bounds-error">
            The floor must be above 0, the cap at most 30, and the floor below the cap.
          </p>
        ) : null}
        {boundsValid && stranded.length > 0 ? (
          <p className="mt-3 text-sm text-error" data-testid="guardrail-stranded-error">
            Band {stranded.map((band) => band.band).join(', ')} would sit outside this window —
            re-rate it first.
          </p>
        ) : null}
        {errorMessage ? (
          <p className="mt-3 text-sm text-error" role="alert" data-testid="guardrail-error">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-4">
          <Button onClick={() => void save()} disabled={!canSave} data-testid="guardrail-save">
            {update.isPending ? 'Saving…' : 'Save guardrail'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
