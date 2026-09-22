'use client';

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../components/Button';
import { Skeleton } from '../components/Skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/Table';
import { EmptyState } from '../feedback/EmptyState';
import { ErrorState } from '../feedback/ErrorState';
import { cn } from '../lib/cn';

export type DataTablePagination = {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Optional total row count — renders "Page X of Y · N total". */
  totalItems?: number;
  /** Optional page size label — renders "· 50 per page". */
  pageSize?: number;
};

export type DataTableDensity = 'comfortable' | 'compact';

/**
 * Row selection (W1 §3.3; built for W7's bulk KYC decisions).
 *
 * IDS, NOT ROW OBJECTS: the caller keeps the selection across refetches —
 * which is the whole point of a bulk action — and an id set survives a refetch
 * that returns new object identities.
 */
export type DataTableSelection<TData> = {
  selectedIds: ReadonlySet<string>;
  getRowId: (row: TData) => string;
  onToggle: (id: string) => void;
  /** Header checkbox; receives every id on the current page, or `[]` to clear. */
  onToggleAll?: (ids: string[]) => void;
};

export type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  /** Server-side pagination — the table never paginates client-side. */
  pagination?: DataTablePagination;
  onRowClick?: (row: TData) => void;
  /** Renders a checkbox column; see `DataTableSelection` for why ids. */
  selection?: DataTableSelection<TData>;
  className?: string;
  /** Row density — compact suits long ops queues; default stays comfortable. */
  density?: DataTableDensity;
  /** Sticky header that stays visible on long scrolls. Defaults on. */
  stickyHeader?: boolean;
};

/**
 * Dense server-driven data table (spec §10.12). Sorting/filtering/pagination
 * are the caller's responsibility (query params to the API) — this component
 * only renders state, including the §10.9 loading/empty/error trio.
 */
export function DataTable<TData>({
  columns,
  data,
  isLoading,
  isError,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  pagination,
  onRowClick,
  selection,
  className,
  density = 'comfortable',
  stickyHeader = true,
}: DataTableProps<TData>) {
  const selectionColumn: ColumnDef<TData, unknown> | null = selection
    ? {
        id: '__selection',
        header: () => {
          const pageIds = data.map(selection.getRowId);
          const allSelected =
            pageIds.length > 0 && pageIds.every((id) => selection.selectedIds.has(id));
          return (
            <input
              type="checkbox"
              aria-label="Select all rows on this page"
              data-testid="select-all-rows"
              className="size-4 accent-brand"
              checked={allSelected}
              disabled={!selection.onToggleAll}
              onChange={(event) => selection.onToggleAll?.(event.target.checked ? pageIds : [])}
            />
          );
        },
        cell: ({ row }) => {
          const id = selection.getRowId(row.original);
          return (
            <input
              type="checkbox"
              aria-label="Select row"
              data-testid={`select-row-${id}`}
              className="size-4 accent-brand"
              checked={selection.selectedIds.has(id)}
              onChange={() => selection.onToggle(id)}
              // Without this a row-click screen would fire its drawer on a
              // selection click.
              onClick={(event) => event.stopPropagation()}
            />
          );
        },
      }
    : null;

  const table = useReactTable({
    data,
    columns: selectionColumn ? [selectionColumn, ...columns] : columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  if (isError) {
    return <ErrorState onRetry={onRetry} />;
  }

  if (isLoading) {
    const skeletonCols = Math.max(3, columns.length);
    return (
      <div
        className={cn(
          'overflow-hidden rounded-card border border-border bg-card',
          'min-h-[320px]',
          className,
        )}
        aria-busy="true"
        aria-label="Loading table"
      >
        <div className="flex gap-3 border-b border-border bg-surface1/60 px-4 py-3">
          {Array.from({ length: skeletonCols }, (_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        <div className="flex flex-col gap-px bg-border/40">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex gap-3 bg-card px-4 py-3">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/6" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={cn('min-h-[240px]', className)}>
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      </div>
    );
  }

  const cellPad = density === 'compact' ? 'py-1.5' : 'py-2.5';
  const pageNumbers = pagination ? pageWindow(pagination.page, pagination.pageCount) : [];

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="overflow-hidden rounded-card border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <Table className="min-h-[120px]">
          <TableHeader className={stickyHeader ? 'admin-sticky-head shadow-[0_1px_0_var(--border)]' : undefined}>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-surface1/50 hover:bg-surface1/50">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(
                  'transition-colors hover:bg-brand-tint/40',
                  onRowClick ? 'cursor-pointer' : undefined,
                )}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={cellPad}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-text-secondary tabular-nums">
            Page {pagination.page} of {pagination.pageCount}
            {pagination.totalItems !== undefined ? ` · ${pagination.totalItems} total` : null}
            {pagination.pageSize !== undefined ? ` · ${pagination.pageSize} per page` : null}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            {pageNumbers.map((p, i) =>
              typeof p === 'string' ? (
                <span key={`ellipsis-${i}`} className="px-1 text-xs text-text-tertiary" aria-hidden>
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === pagination.page ? 'primary' : 'ghost'}
                  size="sm"
                  className="min-w-8 tabular-nums"
                  onClick={() => pagination.onPageChange(p)}
                  aria-label={`Go to page ${p}`}
                  aria-current={p === pagination.page ? 'page' : undefined}
                >
                  {p}
                </Button>
              ),
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.pageCount}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Compact page window: 1 … 4 5 [6] 7 8 … 42. Stable keys, no layout jump. */
function pageWindow(page: number, pageCount: number): Array<number | 'ellipsis'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages = new Set<number>([1, 2, page - 1, page, page + 1, pageCount - 1, pageCount]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: Array<number | 'ellipsis'> = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push('ellipsis');
    out.push(p);
    prev = p;
  }
  return out;
}

export type { ColumnDef };
