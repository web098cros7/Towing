'use client';

import { useState } from 'react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Money,
  Select,
} from '@towing/web-ui';
import {
  resolveBand,
  type AdminChargeConfig,
  type AdminPricingRule,
  type ServiceType,
  type SurgeBand,
} from '@towing/api-contracts';

/**
 * §9.4.8's live worked example: what a fare looks like under the numbers
 * currently in the form above.
 *
 * COMPUTED ON THE CLIENT, from the same config the server serves. The slab walk
 * and the §7.3 interpolation mirror `baseFarePaise` and cannot drift from it in
 * any way an operator would notice: both read the SAME `pricing_rules` rows and
 * the same `charge_config` values this page just fetched. The engine remains
 * the authority — a locked fare is computed server-side at confirm — and the
 * panel says so.
 *
 * The band comes from the shared `resolveBand` (§3.3), so the console and the
 * engine disagree about a band only if the contracts package is wrong.
 */
const SERVICES: ReadonlyArray<{ value: ServiceType; label: string }> = [
  { value: 'tow', label: 'Tow (wheel-lift / flatbed)' },
  { value: 'accident_recovery', label: 'Accident recovery' },
  { value: 'battery', label: 'Battery jumpstart' },
  { value: 'flat_tyre', label: 'Flat tyre' },
  { value: 'fuel', label: 'Fuel delivery' },
  { value: 'breakdown', label: 'Breakdown assistance' },
];

const ROADSIDE = new Set<ServiceType>(['battery', 'flat_tyre', 'fuel', 'breakdown']);
const LONG_DISTANCE_FLOOR_KM = 100;
const CUSTOM_QUOTE_ABOVE_KM = 600;

export function WorkedExample({
  charges,
  rules,
}: {
  charges: AdminChargeConfig;
  rules: AdminPricingRule[];
}) {
  const [distanceKm, setDistanceKm] = useState('8');
  const [vehicleClass, setVehicleClass] = useState<'wheel_lift' | 'flatbed'>('wheel_lift');
  const [service, setService] = useState<ServiceType>('tow');
  const [surgeBand, setSurgeBand] = useState<SurgeBand>('standard');
  const [hour, setHour] = useState('14');
  const [highway, setHighway] = useState(false);
  const [waitingMinutes, setWaitingMinutes] = useState('0');

  const example = computeExample({
    charges,
    rules,
    distanceKm: Number(distanceKm),
    vehicleClass,
    service,
    surgeBand,
    hourOfDay: Number(hour),
    isHighwayPickup: highway,
    waitingMinutes: Number(waitingMinutes),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live worked example</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-text-secondary">
          What the numbers above produce for one trip. The engine locks the real fare at confirm;
          this is the same arithmetic on the same rows.
        </p>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Distance (km)" htmlFor="example-distance">
            <Input
              id="example-distance"
              inputMode="decimal"
              value={distanceKm}
              onChange={(event) => setDistanceKm(event.target.value)}
              data-testid="example-distance"
            />
          </Field>
          <Field label="Vehicle class" htmlFor="example-class">
            <Select
              id="example-class"
              value={vehicleClass}
              onChange={(event) => setVehicleClass(event.target.value as 'wheel_lift' | 'flatbed')}
              data-testid="example-class"
            >
              <option value="wheel_lift">Wheel-lift</option>
              <option value="flatbed">Flatbed</option>
            </Select>
          </Field>
          <Field label="Service" htmlFor="example-service">
            <Select
              id="example-service"
              value={service}
              onChange={(event) => setService(event.target.value as ServiceType)}
              data-testid="example-service"
            >
              {SERVICES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hour of day (IST)" htmlFor="example-hour">
            <Input
              id="example-hour"
              inputMode="numeric"
              value={hour}
              onChange={(event) => setHour(event.target.value)}
              data-testid="example-hour"
            />
          </Field>
          <Field label="Surge band" htmlFor="example-surge">
            <Select
              id="example-surge"
              value={surgeBand}
              onChange={(event) => setSurgeBand(event.target.value as SurgeBand)}
              data-testid="example-surge"
            >
              <option value="standard">Standard (no surge)</option>
              <option value="high">High</option>
              <option value="peak">Peak</option>
            </Select>
          </Field>
          <Field label="Waiting (minutes)" htmlFor="example-waiting">
            <Input
              id="example-waiting"
              inputMode="numeric"
              value={waitingMinutes}
              onChange={(event) => setWaitingMinutes(event.target.value)}
              data-testid="example-waiting"
            />
          </Field>
          <label className="col-span-2 flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              checked={highway}
              onChange={(event) => setHighway(event.target.checked)}
              data-testid="example-highway"
            />
            Pickup inside a highway zone
          </label>
        </div>

        {example.error ? (
          <p className="mt-3 text-sm text-error" data-testid="example-error">
            {example.error}
          </p>
        ) : (
          <table className="mt-4 w-full text-sm" data-testid="example-breakdown">
            <tbody>
              <Line label="Base fare" paise={example.basePaise} />
              <Line label={`Night (${charges.nightPct}%)`} paise={example.nightPaise} />
              <Line label="Highway pickup" paise={example.highwayPaise} />
              <Line label="Accident recovery" paise={example.accidentPaise} />
              <Line
                label={`Waiting (after ${charges.waitingFreeMinutes} free min)`}
                paise={example.waitingPaise}
              />
              <Line label="Surge" paise={example.surgePaise} />
              <tr className="border-t border-border font-semibold">
                <td className="py-2">Total the customer pays</td>
                <td className="py-2 text-right tabular-nums" data-testid="example-total">
                  <Money value={example.totalPaise / 100} exact />
                </td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
          <span>Commission band</span>
          <Badge variant="brand" data-testid="example-band">
            {example.band}
          </Badge>
          <span>
            — the percentage is the band&rsquo;s configured rate; the engine applies it when the
            fare is locked.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Line({ label, paise }: { label: string; paise: number }) {
  return (
    <tr>
      <td className="py-1 text-text-secondary">{label}</td>
      <td className="py-1 text-right tabular-nums">
        <Money value={paise / 100} exact />
      </td>
    </tr>
  );
}

interface ExampleInput {
  charges: AdminChargeConfig;
  rules: AdminPricingRule[];
  distanceKm: number;
  vehicleClass: 'wheel_lift' | 'flatbed';
  service: ServiceType;
  surgeBand: SurgeBand;
  hourOfDay: number;
  isHighwayPickup: boolean;
  waitingMinutes: number;
}

/** Mirrors `computeFare` (§7.4 ordering) against the rows the page has loaded. */
function computeExample(input: ExampleInput) {
  const { charges, rules } = input;
  const empty = {
    basePaise: 0,
    nightPaise: 0,
    highwayPaise: 0,
    accidentPaise: 0,
    waitingPaise: 0,
    surgePaise: 0,
    totalPaise: 0,
    band: 'A' as const,
    error: null as string | null,
  };

  if (!Number.isFinite(input.distanceKm) || input.distanceKm <= 0) {
    return { ...empty, error: 'Enter a distance above zero.' };
  }
  if (input.distanceKm > CUSTOM_QUOTE_ABOVE_KM) {
    return { ...empty, error: `Over ${CUSTOM_QUOTE_ABOVE_KM} km needs a manual quote (§7.3).` };
  }

  const basePaise = baseFromRules(input.service, input.vehicleClass, input.distanceKm, rules);
  if (basePaise === null) {
    return { ...empty, error: 'No active fare covers this trip — check the tables above.' };
  }

  const nightPaise = isNight(input.hourOfDay, charges.nightStartHour, charges.nightEndHour)
    ? Math.round((basePaise * charges.nightPct) / 100)
    : 0;
  const highwayPaise = input.isHighwayPickup ? charges.highwayChargePaise : 0;
  const accidentPaise = input.service === 'accident_recovery' ? charges.accidentChargePaise : 0;
  const waitingPaise =
    input.waitingMinutes > charges.waitingFreeMinutes
      ? (input.waitingMinutes - charges.waitingFreeMinutes) * charges.waitingPerMinutePaise
      : 0;

  const preSurge = basePaise + nightPaise + highwayPaise + accidentPaise + waitingPaise;
  const surgePct =
    input.surgeBand === 'peak'
      ? charges.surgePctPeak
      : input.surgeBand === 'high'
        ? charges.surgePctHigh
        : 0;
  const surgePaise = surgePct > 0 ? Math.round((preSurge * surgePct) / 100) : 0;

  return {
    basePaise,
    nightPaise,
    highwayPaise,
    accidentPaise,
    waitingPaise,
    surgePaise,
    totalPaise: preSurge + surgePaise,
    band: resolveBand(input.service, input.distanceKm),
    error: null,
  };
}

function baseFromRules(
  service: ServiceType,
  vehicleClass: 'wheel_lift' | 'flatbed',
  distanceKm: number,
  rules: AdminPricingRule[],
): number | null {
  const roadside = rules.find(
    (rule) => rule.ruleKind === 'roadside' && rule.serviceType === service && rule.isActive,
  );
  if (roadside) return roadside.pricePaise;

  if (distanceKm > LONG_DISTANCE_FLOOR_KM) {
    const bands = rules
      .filter((rule) => rule.ruleKind === 'long_distance' && rule.isActive && rule.maxKm !== null)
      .sort((a, b) => (a.maxKm ?? 0) - (b.maxKm ?? 0));
    if (bands.length === 0) return null;

    let lowerKm = LONG_DISTANCE_FLOOR_KM;
    for (const band of bands) {
      const maxKm = band.maxKm!;
      if (distanceKm <= maxKm) {
        const ceiling = band.priceMaxPaise ?? band.pricePaise;
        const span = maxKm - lowerKm;
        const t = span > 0 ? (distanceKm - lowerKm) / span : 0;
        return Math.round((band.pricePaise + t * (ceiling - band.pricePaise)) / 100) * 100;
      }
      lowerKm = maxKm;
    }
    const last = bands[bands.length - 1]!;
    return Math.round((last.priceMaxPaise ?? last.pricePaise) / 100) * 100;
  }

  const slabs = rules
    .filter(
      (rule) =>
        rule.ruleKind === 'slab' &&
        rule.vehicleClass === vehicleClass &&
        rule.isActive &&
        rule.maxKm !== null,
    )
    .sort((a, b) => (a.maxKm ?? 0) - (b.maxKm ?? 0));
  if (slabs.length === 0) return null;

  return (slabs.find((slab) => distanceKm <= slab.maxKm!) ?? slabs[slabs.length - 1]!).pricePaise;
}

/** §7.4's window wraps midnight when start > end (22 → 6 does). */
function isNight(hour: number, startHour: number, endHour: number): boolean {
  if (!Number.isFinite(hour)) return false;
  return startHour <= endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}
