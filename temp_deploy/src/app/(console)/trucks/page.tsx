'use client';

import { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { Badge, Button, DataTable, type ColumnDef } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useTrucks } from '@/features/trucks/api/trucks.queries';
import { BulkImportDrawer } from '@/features/trucks/components/BulkImportDrawer';
import { ComplianceDrawer } from '@/features/trucks/components/ComplianceDrawer';
import { TRUCK_TYPE_LABEL, type Truck } from '@/features/trucks/types';

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
  const { data, isLoading, isError, refetch } = useTrucks();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const selected = useMemo(
    () => data?.find((t) => t.id === selectedId) ?? null,
    [data, selectedId],
  );

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
            <Button disabled title="Truck creation goes live with the backend (Phase 4)">
              Add truck
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No trucks yet"
        emptyDescription="Add your first truck to start receiving fleet jobs."
        onRowClick={(truck) => setSelectedId(truck.id)}
      />

      {selected ? <ComplianceDrawer truck={selected} onClose={() => setSelectedId(null)} /> : null}
      {importOpen ? <BulkImportDrawer onClose={() => setImportOpen(false)} /> : null}
    </div>
  );
}
