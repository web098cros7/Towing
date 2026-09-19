'use client';

import { Badge, Card, CardContent, CardHeader, CardTitle } from '@towing/web-ui';
import { resolveBand, serviceTypeSchema, type Band } from '@towing/api-contracts';

/**
 * §9.4.9's "band-to-service mapping view".
 *
 * DERIVED, NOT MAINTAINED. The band for a service at a distance comes from the
 * SHARED `resolveBand` (§3.3) — the same function the fare engine calls — so
 * this view cannot describe a mapping the platform does not implement. It is a
 * rendering of a rule, not a second copy of it.
 */
const DISTANCES: ReadonlyArray<{ label: string; km: number }> = [
  { label: 'Up to 40 km', km: 20 },
  { label: '41–100 km', km: 70 },
  { label: 'Over 100 km', km: 150 },
];

const TONE: Record<Band, 'brand' | 'info' | 'warning'> = {
  A: 'brand',
  B: 'info',
  C: 'warning',
};

export function BandServiceMapping() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Which services fall in which band</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-text-secondary">
          Band follows the service type and the billed distance; accident recovery is never Band A.
        </p>
        <table className="w-full text-sm" data-testid="band-mapping">
          <thead>
            <tr className="text-left text-xs text-text-secondary uppercase">
              <th className="py-1">Service</th>
              {DISTANCES.map((distance) => (
                <th key={distance.label} className="py-1">
                  {distance.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {serviceTypeSchema.options.map((service) => (
              <tr key={service} className="border-t border-border">
                <td className="py-1.5">{service.replace(/_/g, ' ')}</td>
                {DISTANCES.map((distance) => {
                  const band = resolveBand(service, distance.km);
                  return (
                    <td key={distance.label} className="py-1.5">
                      <Badge variant={TONE[band]}>{band}</Badge>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
