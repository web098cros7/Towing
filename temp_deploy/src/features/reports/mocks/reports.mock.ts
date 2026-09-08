import { trucksMock } from '@/features/trucks/mocks/trucks.mock';
import type { ReportQuery, ReportResponse } from '../types';

/**
 * Deterministic mock rows derived from the trucks mock, so the reports screen
 * and the trucks screen name the same vehicles.
 */
export function reportsMock(query: ReportQuery): ReportResponse {
  const period = { from: query.from, to: query.to };

  if (query.groupBy === 'truck') {
    return {
      groupBy: 'truck',
      period,
      rows: trucksMock.slice(0, 6).map((truck, i) => {
        const jobs = 18 - i * 2;
        const gross = 1_240_000 - i * 130_000;
        return {
          truckId: truck.id,
          plate: truck.plate,
          type: truck.type,
          status: truck.status,
          jobs,
          inServiceDays: 30,
          activeDays: 22 - i * 2,
          utilizationPct: Math.round(((22 - i * 2) / 30) * 1000) / 10,
          grossPaise: gross,
          fleetSharePaise: Math.round(gross * 0.18),
          complianceExpiringCount: i === 1 ? 1 : 0,
          complianceExpiredCount: i === 4 ? 1 : 0,
        };
      }),
    };
  }

  if (query.groupBy === 'driver') {
    const names = ['Anita Rao', 'Suresh Kumar', 'Vikram Shetty', 'Meena Iyer', 'Rahul Nair'];
    return {
      groupBy: 'driver',
      period,
      rows: names.map((name, i) => {
        const gross = 1_480_000 - i * 210_000;
        const pool = Math.round(gross * 0.9);
        const fleetShare = Math.round(pool * 0.2);
        return {
          driverId: `drv-mock-${i}`,
          name,
          kycStatus: 'approved',
          jobs: 21 - i * 3,
          grossPaise: gross,
          driverSharePaise: pool - fleetShare,
          fleetSharePaise: fleetShare,
          ratingAvg: 4.8 - i * 0.1,
        };
      }),
    };
  }

  const days = Math.min(
    14,
    Math.max(1, Math.round((Date.parse(query.to) - Date.parse(query.from)) / 86_400_000) + 1),
  );

  return {
    groupBy: 'period',
    period,
    granularity: query.granularity,
    rows: Array.from({ length: days }, (_, i) => {
      const gross = 280_000 + ((i * 53) % 9) * 46_000;
      const commission = Math.round(gross * 0.1);
      const pool = gross - commission;
      const fleetShare = Math.round(pool * 0.2);
      return {
        bucket: new Date(Date.parse(query.from) + i * 86_400_000).toISOString().slice(0, 10),
        jobs: 4 + (i % 5),
        grossPaise: gross,
        commissionPaise: commission,
        poolPaise: pool,
        driverSharePaise: pool - fleetShare,
        fleetSharePaise: fleetShare,
      };
    }),
  };
}
