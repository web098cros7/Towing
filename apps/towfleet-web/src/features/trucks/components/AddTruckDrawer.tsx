'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { truckCreateSchema } from '@towing/api-contracts';
import { Button, Field, Input, cn } from '@towing/web-ui';
import { useCreateTruck } from '../api/trucks.mutations';
import { TRUCK_TYPE_LABEL, type TruckType } from '../types';

const TRUCK_TYPES: TruckType[] = ['flatbed', 'wheel_lift'];

/**
 * "Add truck" (§9.3.4): plate, type and capacity, plus the make and model the
 * customer's vehicle card shows ("Tata 407"). Validated with the same
 * `truckCreateSchema` the server uses; the server's answer (a duplicate plate)
 * is shown under the form.
 */
export function AddTruckDrawer({ onClose }: { onClose: () => void }) {
  const create = useCreateTruck();
  const [plate, setPlate] = useState('');
  const [type, setType] = useState<TruckType>('flatbed');
  const [capacity, setCapacity] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');

  const parsed = truckCreateSchema.safeParse({
    plate: plate.trim(),
    type,
    capacityTons: Number(capacity),
    make: make.trim() || null,
    model: model.trim() || null,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.success) return;
    create.mutate(parsed.data, { onSuccess: onClose });
  };

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-card p-6 shadow-xl"
      data-testid="add-truck-drawer"
    >
      <div className="mb-4 flex items-start justify-between">
        <h2 className="font-display text-xl font-bold">Add truck</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close drawer">
          <X className="size-4" />
        </Button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Plate" htmlFor="truck-plate">
          <Input
            id="truck-plate"
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            placeholder="KA-01-AB-1234"
            required
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Type</span>
          <div className="flex flex-wrap gap-1">
            {TRUCK_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                aria-pressed={type === t}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  type === t
                    ? 'bg-brand text-on-brand'
                    : 'bg-surface1 text-text-secondary hover:text-text-primary',
                )}
              >
                {TRUCK_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        <Field label="Capacity (tonnes)" htmlFor="truck-capacity">
          <Input
            id="truck-capacity"
            type="number"
            inputMode="decimal"
            min="0.5"
            max="50"
            step="0.5"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Make" htmlFor="truck-make">
            <Input
              id="truck-make"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="Tata"
              maxLength={40}
            />
          </Field>
          <Field label="Model" htmlFor="truck-model">
            <Input
              id="truck-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="407"
              maxLength={40}
            />
          </Field>
        </div>
        <p className="text-xs text-text-secondary">
          Customers see the make and model on their booking, so they can spot the truck.
        </p>
        {create.isError ? (
          <p className="text-xs text-error">{(create.error as Error).message}</p>
        ) : null}
        <Button type="submit" disabled={create.isPending || !parsed.success}>
          {create.isPending ? 'Adding…' : 'Add truck'}
        </Button>
      </form>
    </aside>
  );
}
