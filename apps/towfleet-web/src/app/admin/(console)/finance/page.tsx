'use client';

import { useState } from 'react';
import { Tabs } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { PayoutApprovalsTab } from '@/features/admin-finance/components/PayoutApprovalsTab';
import { TransactionsTab } from '@/features/admin-finance/components/TransactionsTab';
import { LedgerTab } from '@/features/admin-finance/components/LedgerTab';
import { RefundsTab } from '@/features/admin-finance/components/RefundsTab';
import { FinanceConfigTab } from '@/features/admin-finance/components/FinanceConfigTab';

type FinanceTab = 'payouts' | 'transactions' | 'ledger' | 'refunds' | 'config';

/**
 * `/admin/finance` — W9's finance console.
 *
 * PAYOUTS IS THE DEFAULT because it is what somebody opening this page came to
 * do: a queue with a decision waiting. The other tabs answer the questions that
 * follow a decision — what moved, what it left behind, what has been given
 * back, and which knobs decide it.
 *
 * The SLA card and the invariants panel ride UNDER the payouts table rather
 * than in a separate health tab: nobody opens a health tab until something is
 * already wrong, and those two are the numbers that should catch it first.
 */
export default function AdminFinancePage() {
  const [tab, setTab] = useState<FinanceTab>('payouts');

  return (
    <div>
      <PageHeader
        title="Finance"
        description="Approvals, money movement and the ledger's own health."
      />

      <Tabs
        items={[
          { value: 'payouts', label: 'Payouts' },
          { value: 'transactions', label: 'Transactions' },
          { value: 'ledger', label: 'Wallet ledger' },
          { value: 'refunds', label: 'Refunds' },
          { value: 'config', label: 'Policy' },
        ]}
        value={tab}
        onChange={setTab}
        aria-label="Finance sections"
        className="mb-5"
      />

      {tab === 'payouts' ? <PayoutApprovalsTab /> : null}
      {tab === 'transactions' ? <TransactionsTab /> : null}
      {tab === 'ledger' ? <LedgerTab /> : null}
      {tab === 'refunds' ? <RefundsTab /> : null}
      {tab === 'config' ? <FinanceConfigTab /> : null}
    </div>
  );
}
