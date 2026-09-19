'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../components/Button';
import { Skeleton } from '../components/Skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/Table';
import { EmptyState } from '../feedback/EmptyState';
import { ErrorState } from '../feedback/ErrorState';
import { cn } from '../lib/cn';

export type DataTablePagination = {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
};

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
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
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
              className={onRowClick ? 'cursor-pointer' : undefined}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {pagination && pagination.pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-text-secondary">
            Page {pagination.page} of {pagination.pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.page <= 1}
            onClick={() => pagination.onPageChange(pagination.page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
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
      ) : null}
    </div>
  );
}

export type { ColumnDef };
