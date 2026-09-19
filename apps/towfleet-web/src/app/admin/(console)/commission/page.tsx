'use client';

import { useState } from 'react';
import { Skeleton } from '@towing/web-ui';
import type { Band } from '@towing/api-contracts';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { useAdminCommission } from '@/features/admin-commission/api/adminCommission.queries';
import { BandEditor } from '@/features/admin-commission/components/BandEditor';
import { BandServiceMapping } from '@/features/admin-commission/components/BandServiceMapping';
import { CommissionHistoryTable } from '@/features/admin-commission/components/CommissionHistoryTable';
import { GuardrailEditor } from '@/features/admin-commission/components/GuardrailEditor';
import { ImpactPreview } from '@/features/admin-commission/components/ImpactPreview';
import { ProposalsPanel } from '@/features/admin-commission/components/ProposalsPanel';

/**
 * `/admin/commission` — W11's §9.4.9 screen.
 *
 * THREE AUDIENCES, ONE PAGE, and the buttons differ:
 *   · Finance / super admin hold `commission.edit` — they save bands and decide
 *     on proposals;
 *   · Operations holds `commission.propose` — read-only bands, with the propose
 *     form and the live guardrail to validate against;
 *   · a super admin alone holds `commission.guardrail` and sees the window
 *     editor (decision G2).
 */
export default function AdminCommissionPage() {
  const can = useAdminCan();
  const canEdit = can('commission.edit');
  const canPropose = can('commission.propose');
  const canGuardrail = can('commission.guardrail');

  const { data, isLoading, isError } = useAdminCommission();
  // Shared with the impact preview: the preview asks about what the operator
  // has typed, not about what is saved.
  const [draft, setDraft] = useState<Record<Band, string>>({ A: '', B: '', C: '' });

  if (!canEdit && !canPropose) {
    return (
      <div>
        <PageHeader
          title="Commission"
          description="Bands, the guardrail they live inside, and the trail behind them."
        />
        <AdminForbidden resource="the commission editor" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Commission"
        description="Bands, the guardrail they live inside, and the trail behind them."
      />

      {isError ? (
        <p className="text-sm text-error">Could not load the commission configuration.</p>
      ) : isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="space-y-5">
          <BandEditor config={data} canEdit={canEdit} draft={draft} onDraftChange={setDraft} />
          <ImpactPreview draft={draft} />
          <ProposalsPanel config={data} canPropose={canPropose} canDecide={canEdit} />
          <BandServiceMapping />
          {canGuardrail ? <GuardrailEditor config={data} /> : null}
          <CommissionHistoryTable />
        </div>
      )}
    </div>
  );
}
