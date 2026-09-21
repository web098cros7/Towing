'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@towing/web-ui';
import type { AdminPricingConfig, AdminPricingRule } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import {
  useCreatePricingRule,
  useDeactivatePricingRule,
  useUpdatePricing,
} from '../api/adminPricing.mutations';

/** Non-null form of the contract's vehicle class — the matrices are per class. */
type VehicleClass = NonNullable<AdminPricingRule['vehicleClass']>;

const CLASSES: ReadonlyArray<{ vehicleClass: VehicleClass; label: string }> = [
  { vehicleClass: 'wheel_lift', label: 'Wheel-lift' },
  { vehicleClass: 'flatbed', label: 'Flatbed' },
];

/**
 * §7.1/§7.2's base-fare tables, and §9.4.8's "editable base-fare matrices".
 *
 * TWO TABLES, NOT A MULTIPLIER (decision G9). The vehicle class *selects* a
 * slab table; it does not scale one. A "vehicle multiplier" would be a new
 * column, a new term in the fare maths and every locked-fare test moving — and
 * it is not what §7.1/§7.2 describe.
 *
 * SAVE SENDS A DIFF. Only rows whose price the operator actually changed appear
 * in the body — `adminPricingUpdateSchema` is deliberately all-optional with no
 * defaults so that a save two minutes after somebody else's edit leaves their
 * edit alone.
 *
 * RETIRE, NEVER DELETE. `is_active = false` takes a band out of the rate card
 * while the row stays for history; the add form refuses a duplicate of an
 * ACTIVE band and points at deactivate, which is what the API's 409 says too.
 */
export function PricingMatrices({
  config,
  canEdit,
}: {
  config: AdminPricingConfig;
  canEdit: boolean;
}) {
  const toast = useToast();
  const update = useUpdatePricing();
  const create = useCreatePricingRule();
  const deactivate = useDeactivatePricingRule();

  /** ruleId → rupees as typed. */
  const [prices, setPrices] = useState<Record<string, string>>({});
  /** ruleId → ceiling rupees (long-distance rows only). */
  const [ceilings, setCeilings] = useState<Record<string, string>>({});
  /** class → the "add a band" row's fields. */
  const [newBand, setNewBand] = useState<Record<string, { maxKm: string; price: string }>>({
    wheel_lift: { maxKm: '', price: '' },
    flatbed: { maxKm: '', price: '' },
  });
  const [pendingRetire, setPendingRetire] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Re-seed whenever the server config changes (including our own saves).
  useEffect(() => {
    setPrices(
      Object.fromEntries(config.rules.map((rule) => [rule.id, (rule.pricePaise / 100).toString()])),
    );
    setCeilings(
      Object.fromEntries(
        config.rules.map((rule) => [
          rule.id,
          rule.priceMaxPaise === null ? '' : (rule.priceMaxPaise / 100).toString(),
        ]),
      ),
    );
  }, [config]);

  const rupees = (value: string): number => Number(value);
  const toPaise = (value: string): number => Math.round(rupees(value) * 100);

  /** The diff, row by row — empty means "nothing to save". */
  const changedRules = config.rules
    .filter((rule) => {
      if (!canEdit) return false;
      const typed = prices[rule.id];
      if (typed === undefined || typed === '' || !Number.isFinite(rupees(typed))) return false;
      if (toPaise(typed) !== rule.pricePaise) return true;
      if (rule.priceMaxPaise !== null) {
        const typedCeiling = ceilings[rule.id];
        if (typedCeiling === undefined || typedCeiling === '') return false;
        return toPaise(typedCeiling) !== rule.priceMaxPaise;
      }
      return false;
    })
    .map((rule) => {
      const patch: { id: string; pricePaise: number; priceMaxPaise?: number } = {
        id: rule.id,
        pricePaise: toPaise(prices[rule.id]!),
      };
      if (rule.priceMaxPaise !== null) patch.priceMaxPaise = toPaise(ceilings[rule.id]!);
      return patch;
    });

  const invalidRow = config.rules.find((rule) => {
    const typed = prices[rule.id];
    if (typed === undefined) return false;
    if (typed === '' || !Number.isFinite(rupees(typed)) || rupees(typed) < 0) return true;
    if (rule.priceMaxPaise !== null) {
      const typedCeiling = ceilings[rule.id];
      if (
        typedCeiling === undefined ||
        typedCeiling === '' ||
        !Number.isFinite(rupees(typedCeiling))
      )
        return true;
      // A ceiling below the floor quotes a longer tow LESS than a shorter one.
      return toPaise(typedCeiling) < toPaise(typed);
    }
    return false;
  });

  const savePrices = async () => {
    if (!canEdit || (changedRules.length === 0 && config.rules.length > 0)) {
      toast('Nothing changed', 'info');
      return;
    }
    setErrorMessage(null);
    try {
      await update.mutateAsync({ rules: changedRules });
      toast('Fares saved — new bookings price from them immediately', 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const addBand = async (vehicleClass: VehicleClass) => {
    const draft = newBand[vehicleClass]!;
    const maxKm = rupees(draft.maxKm);
    const pricePaise = toPaise(draft.price);
    if (!Number.isFinite(maxKm) || maxKm <= 0 || !Number.isFinite(pricePaise) || pricePaise < 0) {
      setErrorMessage('A new band needs a distance above zero and a price.');
      return;
    }
    const duplicate = activeSlabs(vehicleClass, config).some((rule) => rule.maxKm === maxKm);
    if (duplicate) {
      const label =
        CLASSES.find((entry) => entry.vehicleClass === vehicleClass)?.label ?? vehicleClass;
      setErrorMessage(
        `${label} already prices up to ${maxKm} km — retire that band first, or pick another distance.`,
      );
      return;
    }

    setErrorMessage(null);
    try {
      await create.mutateAsync({ ruleKind: 'slab', vehicleClass, maxKm, pricePaise });
      setNewBand((current) => ({ ...current, [vehicleClass]: { maxKm: '', price: '' } }));
      toast(`Band added: ${maxKm} km · ₹${pricePaise / 100}`, 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const retire = async (rule: AdminPricingRule) => {
    setErrorMessage(null);
    try {
      await deactivate.mutateAsync({
        ruleId: rule.id,
        body: { reason: 'Retired from the console' },
      });
      setPendingRetire(null);
      toast(`Band retired: ${rule.maxKm} km`, 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CLASSES.map(({ vehicleClass, label }) => (
          <Card key={vehicleClass}>
            <CardHeader>
              <CardTitle>{label} base fares</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm" data-testid={`matrix-${vehicleClass}`}>
                <thead>
                  <tr className="text-left text-xs text-text-secondary uppercase">
                    <th className="py-1">Up to</th>
                    <th className="py-1">Fare (₹)</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {activeSlabs(vehicleClass, config).map((rule) => (
                    <tr key={rule.id} className="border-t border-border">
                      <td className="py-1.5 tabular-nums">{rule.maxKm} km</td>
                      <td className="py-1.5 pr-2">
                        <Input
                          aria-label={`${label} fare up to ${rule.maxKm} km`}
                          inputMode="decimal"
                          value={prices[rule.id] ?? ''}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setPrices((current) => ({ ...current, [rule.id]: event.target.value }))
                          }
                          data-testid={`pricing-price-${vehicleClass}-${rule.maxKm}`}
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        {pendingRetire === rule.id ? (
                          <span className="flex items-center gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => void retire(rule)}
                              data-testid={`pricing-confirm-retire-${vehicleClass}-${rule.maxKm}`}
                            >
                              Confirm
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPendingRetire(null)}
                            >
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canEdit}
                            onClick={() => setPendingRetire(rule.id)}
                            data-testid={`pricing-deactivate-${vehicleClass}-${rule.maxKm}`}
                          >
                            Retire
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {retiredSlabs(vehicleClass, config).map((rule) => (
                    <tr key={rule.id} className="border-t border-border text-text-tertiary">
                      <td className="py-1.5 tabular-nums">{rule.maxKm} km</td>
                      <td className="py-1.5">₹{(rule.pricePaise / 100).toLocaleString('en-IN')}</td>
                      <td className="py-1.5 text-right">
                        <Badge>Retired</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3 flex items-end gap-2">
                <label className="text-xs text-text-secondary">
                  New band up to (km)
                  <Input
                    aria-label={`New ${label} band distance`}
                    inputMode="decimal"
                    value={newBand[vehicleClass]?.maxKm ?? ''}
                    disabled={!canEdit}
                    onChange={(event) =>
                      setNewBand((current) => ({
                        ...current,
                        [vehicleClass]: { ...current[vehicleClass]!, maxKm: event.target.value },
                      }))
                    }
                    data-testid={`pricing-new-${vehicleClass}-km`}
                  />
                </label>
                <label className="text-xs text-text-secondary">
                  Fare (₹)
                  <Input
                    aria-label={`New ${label} band fare`}
                    inputMode="decimal"
                    value={newBand[vehicleClass]?.price ?? ''}
                    disabled={!canEdit}
                    onChange={(event) =>
                      setNewBand((current) => ({
                        ...current,
                        [vehicleClass]: { ...current[vehicleClass]!, price: event.target.value },
                      }))
                    }
                    data-testid={`pricing-new-${vehicleClass}-price`}
                  />
                </label>
                <Button
                  variant="secondary"
                  disabled={!canEdit || create.isPending}
                  onClick={() => void addBand(vehicleClass)}
                  data-testid={`pricing-add-${vehicleClass}`}
                >
                  Add band
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Long-distance ranges (flatbed)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-text-secondary">
              §7.3 publishes ranges; the fare slides from the floor at the band&rsquo;s lower bound
              to the ceiling at its upper bound.
            </p>
            <table className="w-full text-sm" data-testid="matrix-long-distance">
              <thead>
                <tr className="text-left text-xs text-text-secondary uppercase">
                  <th className="py-1">Up to</th>
                  <th className="py-1">Floor (₹)</th>
                  <th className="py-1">Ceiling (₹)</th>
                </tr>
              </thead>
              <tbody>
                {config.rules
                  .filter((rule) => rule.ruleKind === 'long_distance' && rule.isActive)
                  .map((rule) => (
                    <tr key={rule.id} className="border-t border-border">
                      <td className="py-1.5 tabular-nums">{rule.maxKm} km</td>
                      <td className="py-1.5 pr-2">
                        <Input
                          aria-label={`Long-distance floor to ${rule.maxKm} km`}
                          inputMode="decimal"
                          value={prices[rule.id] ?? ''}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setPrices((current) => ({ ...current, [rule.id]: event.target.value }))
                          }
                          data-testid={`pricing-price-long-${rule.maxKm}`}
                        />
                      </td>
                      <td className="py-1.5">
                        <Input
                          aria-label={`Long-distance ceiling to ${rule.maxKm} km`}
                          inputMode="decimal"
                          value={ceilings[rule.id] ?? ''}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setCeilings((current) => ({
                              ...current,
                              [rule.id]: event.target.value,
                            }))
                          }
                          data-testid={`pricing-ceiling-long-${rule.maxKm}`}
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Flat roadside call-outs</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm" data-testid="matrix-roadside">
              <thead>
                <tr className="text-left text-xs text-text-secondary uppercase">
                  <th className="py-1">Service</th>
                  <th className="py-1">Fare (₹)</th>
                </tr>
              </thead>
              <tbody>
                {config.rules
                  .filter((rule) => rule.ruleKind === 'roadside' && rule.isActive)
                  .map((rule) => (
                    <tr key={rule.id} className="border-t border-border">
                      <td className="py-1.5">{rule.serviceType?.replace(/_/g, ' ')}</td>
                      <td className="py-1.5">
                        <Input
                          aria-label={`${rule.serviceType} fare`}
                          inputMode="decimal"
                          value={prices[rule.id] ?? ''}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setPrices((current) => ({ ...current, [rule.id]: event.target.value }))
                          }
                          data-testid={`pricing-price-roadside-${rule.serviceType}`}
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {invalidRow ? (
        <p className="mt-3 text-sm text-error" data-testid="pricing-rules-error">
          Every fare needs a number, and a range ceiling must not sit below its floor.
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-1 text-sm text-error" role="alert" data-testid="pricing-error">
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-4">
        <Button
          onClick={() => void savePrices()}
          disabled={
            !canEdit || update.isPending || changedRules.length === 0 || Boolean(invalidRow)
          }
          data-testid="pricing-save-rules"
        >
          {update.isPending ? 'Saving…' : 'Save fares'}
        </Button>
      </div>
    </div>
  );
}

function activeSlabs(vehicleClass: VehicleClass, config: AdminPricingConfig): AdminPricingRule[] {
  return config.rules
    .filter(
      (rule) =>
        rule.ruleKind === 'slab' &&
        rule.vehicleClass === vehicleClass &&
        rule.isActive &&
        rule.maxKm !== null,
    )
    .sort((a, b) => (a.maxKm ?? 0) - (b.maxKm ?? 0));
}

function retiredSlabs(vehicleClass: VehicleClass, config: AdminPricingConfig): AdminPricingRule[] {
  return config.rules
    .filter(
      (rule) => rule.ruleKind === 'slab' && rule.vehicleClass === vehicleClass && !rule.isActive,
    )
    .sort((a, b) => (a.maxKm ?? 0) - (b.maxKm ?? 0));
}
