'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Upload } from 'lucide-react';
import { Badge, Button, DataTable, FilterBar, SearchInput, type ColumnDef } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useTrucks } from '@/features/trucks/api/trucks.queries';
import { AddTruckDrawer } from '@/features/trucks/components/AddTruckDrawer';
import { BulkImportDrawer } from '@/features/trucks/components/BulkImportDrawer';
import { ComplianceDrawer } from '@/features/trucks/components/ComplianceDrawer';
import { TRUCK_TYPE_LABEL, truckMakeModel, type Truck } from '@/features/trucks/types';

function complianceSummary(truck: Truck) {
  const expired = truck.compliance.filter((d) => d.status === 'expired').length;
  const expiring = truck.compliance.filter((d) => d.status === 'expiring').length;
  if (expired > 0) return <Badge variant="error">{expired} expired</Badge>;
  if (expiring > 0) return <Badge variant="warning">{expiring} expiring</Badge>;
  return <Badge variant="success">All valid</Badge>;
}

const columns: ColumnDef<Truck, unknown>[] = [
  { accessorKey: 'plate', header: 'Plate', cell: ({ row }) => <span className="font-semibold">{row.original.plate}</span> },
  { accessorKey: 'type', header: 'Type', cell: ({ row }) => TRUCK_TYPE_LABEL[row.original.type] },
  {
    id: 'makeModel',
    header: 'Make & model',
    cell: ({ row }) =>
      truckMakeModel(row.original) ?? <span className="text-text-tertiary">Not set</span>,
  },
  { accessorKey: 'capacityTons', header: 'Capacity', cell: ({ row }) => `${row.original.capacityTons}t` },
  {
    accessorKey: 'assignedDriverName',
    header: 'Driver',
    cell: ({ row }) => row.original.assignedDriverName ?? <span className="text-text-tertiary">Unassigned</span>,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) =>
      row.original.status === 'active' ? (
        <Badge variant="success">Active</Badge>
      ) : row.original.status === 'inactive' ? (
        <Badge variant="neutral">Inactive</Badge>
      ) : (
        <Badge variant="error">Non-compliant</Badge>
      ),
  },
  { id: 'compliance', header: 'Compliance', cell: ({ row }) => complianceSummary(row.original) },
];

export default function TrucksPage() {
  return (
    <Suspense>
      <TrucksList />
    </Suspense>
  );
}

function TrucksList() {
  const { data, isLoading, isError, refetch } = useTrucks();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Palette deep-link (`/trucks?q=KA01…`) seeds the filter; typing afterwards
  // stays local so the back button keeps working.
  const searchParams = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get('q') ?? '');
  // Alert deep-link (`/trucks?truck=<id>`) opens that truck's checklist. Keyed on the param, so
  // closing the drawer does not reopen it, while a NEW link (the palette, another alert) does.
  // An id that is not in the fleet simply opens nothing: `selected` below resolves to null.
  const truckParam = searchParams.get('truck');
  useEffect(() => {
    if (truckParam) setSelectedId(truckParam);
  }, [truckParam]);

  const selected = useMemo(
    () => data?.find((t) => t.id === selectedId) ?? null,
    [data, selectedId],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return data ?? [];
    return (data ?? []).filter((t) =>
      [t.plate, t.assignedDriverName ?? '', truckMakeModel(t) ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [data, q]);

  return (
    <div>
      <PageHeader
        title="Trucks"
        description="Compliance checklist per truck — expired documents remove a truck from dispatch automatically."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> Import CSV
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Add truck
            </Button>
          </>
        }
      />

      <FilterBar className="mb-4">
        <SearchInput
          value={q}
          onValueChange={setQ}
          placeholder="Plate, driver or make"
          className="w-72"
          data-testid="trucks-search"
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle={q ? 'No trucks match' : 'No trucks yet'}
        emptyDescription={
          q ? 'Clear the search to see the whole fleet.' : 'Add your first truck to start receiving fleet jobs.'
        }
        onRowClick={(truck) => setSelectedId(truck.id)}
      />

      {selected ? <ComplianceDrawer truck={selected} onClose={() => setSelectedId(null)} /> : null}
      {importOpen ? <BulkImportDrawer onClose={() => setImportOpen(false)} /> : null}
      {addOpen ? <AddTruckDrawer onClose={() => setAddOpen(false)} /> : null}
    </div>
  );
}
