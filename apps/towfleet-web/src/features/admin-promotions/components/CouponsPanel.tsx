'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  type ColumnDef,
  DataTable,
  FilterBar,
  Money,
  SearchInput,
  Select,
  StatusChip,
} from '@towing/web-ui';
import { paiseToRupeeString, type AdminCoupon } from '@towing/api-contracts';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { ApiError } from '@/lib/apiClient';
import { useAdminCoupons } from '../api/adminPromotions.queries';
import { usesLabel, valueLabel, windowLabel } from '../lib/promotionsMath';
import { CouponEditorDrawer } from './CouponEditorDrawer';

const columns: ColumnDef<AdminCoupon, unknown>[] = [
  {
    accessorKey: 'code',
    header: 'Code',
    cell: ({ row }) => <span className="font-mono font-semibold">{row.original.code}</span>,
  },
  {
    id: 'value',
    header: 'Value',
    cell: ({ row }) => valueLabel(row.original),
  },
  {
    id: 'minOrder',
    header: 'Min order',
    cell: ({ row }) =>
      row.original.minOrderPaise > 0 ? (
        <Money value={paiseToRupeeString(row.original.minOrderPaise)} />
      ) : (
        <span className="text-text-tertiary">—</span>
      ),
  },
  {
    id: 'uses',
    header: 'Used',
    cell: ({ row }) => <span className="tabular-nums">{usesLabel(row.original)}</span>,
  },
  {
    id: 'window',
    header: 'Window',
    cell: ({ row }) => (
      <span className="text-text-secondary">{windowLabel(row.original)}</span>
    ),
  },
  {
    id: 'active',
    header: 'Active',
    cell: ({ row }) => (
      <StatusChip
        status={row.original.isActive ? 'active' : 'inactive'}
        tone={row.original.isActive ? 'success' : 'neutral'}
      />
    ),
  },
];

/**
 * `/admin/promotions` — the coupon half (§9.4.11).
 *
 * The list never shows `used_count` as editable and the editor has no field
 * for it: the counter belongs to the confirm transaction, and the console's
 * only power over it is through `maxUses` (the cap the conditional UPDATE
 * enforces).
 */
export function CouponsPanel() {
  const [code, setCode] = useState('');
  const [active, setActive] = useState<'' | 'true' | 'false'>('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<AdminCoupon | 'new' | null>(null);
  const limit = 25;

  const query = {
    page,
    limit,
    ...(code.trim().length > 0 ? { code: code.trim() } : {}),
    ...(active === '' ? {} : { isActive: active }),
  };

  const { data, isLoading, isError, error, refetch } = useAdminCoupons(query);

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / limit));
  useEffect(() => {
    if (data !== undefined && page > pageCount) setPage(pageCount);
  }, [data, page, pageCount]);

  if (error instanceof ApiError && error.status === 403) {
    return <AdminForbidden resource="the promotions console" />;
  }

  return (
    <div>
      <FilterBar className="mb-4">
        <SearchInput
          className="w-64"
          value={code}
          onValueChange={(value) => {
            setCode(value);
            setPage(1);
          }}
          placeholder="Search codes"
          data-testid="coupons-search"
          aria-label="Search coupon codes"
        />
        <Select
          className="w-40"
          value={active}
          onChange={(event) => {
            setActive(event.target.value as '' | 'true' | 'false');
            setPage(1);
          }}
          data-testid="coupons-active-filter"
          aria-label="Active filter"
        >
          <option value="">Active + inactive</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </Select>
        <Button className="ml-auto" data-testid="coupon-new" onClick={() => setTarget('new')}>
          New coupon
        </Button>
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No coupons match"
        emptyDescription="Adjust the filters, or create the first one."
        pagination={{ page, pageCount, onPageChange: setPage }}
        onRowClick={(row) => setTarget(row)}
      />

      <CouponEditorDrawer target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
