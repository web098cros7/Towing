import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../db/schema';
import { alerts, complianceDocuments, fleetTrucks } from '../../db/schema';

/**
 * Structural minimum, not the DI `Database` token: the seed script holds a
 * plain drizzle handle with no `$client`, and both callers must fit.
 */
type SweepDatabase = PostgresJsDatabase<typeof schema>;

/**
 * The compliance engine (§9.3.4).
 *
 * A plain function over a Drizzle handle rather than a Nest service, mirroring
 * `runSeed()`: the queue worker, the e2e tests and `pnpm db:seed` all need to
 * run exactly this logic, and only one of them has a DI container.
 * `ComplianceService` wraps it to add the notification and realtime event.
 *
 * IDEMPOTENCE IS THE WHOLE DESIGN. This runs hourly, so every write is either a
 * no-op on re-run or guarded by a constraint:
 *   · document status transitions are `WHERE status <> $new`, so a settled doc
 *     is not touched;
 *   · alerts upsert against `uq_alerts_open_subject` (partial unique on
 *     unresolved rows), so an hourly re-run cannot stack duplicates;
 *   · `alert_sent_30d` records that the human was told, separately from whether
 *     an alert row is currently open — a resolved-then-recurring alert must not
 *     re-notify for the same document in the same window.
 */

const THIRTY_DAYS_MS = 30 * 86_400_000;

export interface SweepResult {
  /** Docs moved `valid|expiring_soon → expired`. */
  expired: number;
  /** Docs moved `valid → expiring_soon`. */
  expiringSoon: number;
  /** Trucks moved `active → non_compliant`. */
  trucksBlocked: number;
  /** Trucks moved `non_compliant → active` because papers were renewed. */
  trucksCleared: number;
  alertsOpened: number;
  alertsResolved: number;
  /** Docs newly flagged as notified — the notification fan-out list. */
  notify: NotifyTarget[];
}

export interface NotifyTarget {
  fleetId: string;
  docId: string;
  truckPlate: string;
  docType: string;
  expiresAt: Date;
  daysLeft: number;
}

export function emptySweepResult(): SweepResult {
  return {
    expired: 0,
    expiringSoon: 0,
    trucksBlocked: 0,
    trucksCleared: 0,
    alertsOpened: 0,
    alertsResolved: 0,
    notify: [],
  };
}

const DOC_LABEL: Record<string, string> = {
  insurance: 'Insurance',
  rc: 'RC',
  puc: 'PUC',
  permit: 'Permit',
};

const label = (docType: string): string => DOC_LABEL[docType] ?? docType;

export function daysUntil(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000));
}

/**
 * Runs the whole sweep. `fleetId` narrows it to one tenant (used by tests and
 * by the "recheck this fleet now" path); omitted, it sweeps every fleet.
 */
export async function runComplianceSweep(
  db: SweepDatabase,
  options: { now?: Date; fleetId?: string } = {},
): Promise<SweepResult> {
  const now = options.now ?? new Date();
  const result = emptySweepResult();
  const horizon = new Date(now.getTime() + THIRTY_DAYS_MS);

  const fleetScope = options.fleetId
    ? sql`and t.fleet_id = ${options.fleetId}`
    : sql``;

  // 1. Expiry transitions. `status <> 'expired'` keeps this a no-op on re-run.
  const expired = await db.execute<{ id: string }>(sql`
    update compliance_documents d
    set status = 'expired', updated_at = ${now.toISOString()}
    from fleet_trucks t
    where d.truck_id = t.id
      and d.expires_at is not null
      and d.expires_at < ${now.toISOString()}
      and d.status <> 'expired'
      ${fleetScope}
    returning d.id
  `);
  result.expired = expired.length;

  // 2. Entering the 30-day window.
  const expiring = await db.execute<{ id: string }>(sql`
    update compliance_documents d
    set status = 'expiring_soon', updated_at = ${now.toISOString()}
    from fleet_trucks t
    where d.truck_id = t.id
      and d.expires_at is not null
      and d.expires_at >= ${now.toISOString()}
      and d.expires_at <= ${horizon.toISOString()}
      and d.status <> 'expiring_soon'
      ${fleetScope}
    returning d.id
  `);
  result.expiringSoon = expiring.length;

  // 3. A renewed document must be able to walk back to `valid`, or a truck
  //    stays blocked forever after its papers are fixed.
  await db.execute(sql`
    update compliance_documents d
    set status = 'valid', updated_at = ${now.toISOString()}
    from fleet_trucks t
    where d.truck_id = t.id
      and d.expires_at is not null
      and d.expires_at > ${horizon.toISOString()}
      and d.status <> 'valid'
      ${fleetScope}
  `);

  // 4. Truck status follows its documents (§3.2 dispatch exclusion). Manual
  //    `inactive` is sticky — the recompute only moves active ↔ non_compliant,
  //    exactly as the Phase 4 upsert path does.
  const blocked = await db.execute<{ id: string }>(sql`
    update fleet_trucks t
    set status = 'non_compliant', updated_at = ${now.toISOString()}
    where t.status = 'active'
      and exists (
        select 1 from compliance_documents d
        where d.truck_id = t.id and d.status = 'expired'
      )
      ${options.fleetId ? sql`and t.fleet_id = ${options.fleetId}` : sql``}
    returning t.id
  `);
  result.trucksBlocked = blocked.length;

  const cleared = await db.execute<{ id: string }>(sql`
    update fleet_trucks t
    set status = 'active', updated_at = ${now.toISOString()}
    where t.status = 'non_compliant'
      and not exists (
        select 1 from compliance_documents d
        where d.truck_id = t.id and d.status = 'expired'
      )
      ${options.fleetId ? sql`and t.fleet_id = ${options.fleetId}` : sql``}
    returning t.id
  `);
  result.trucksCleared = cleared.length;

  // 5. Alerts for everything currently expiring or expired.
  const open = await db
    .select({
      docId: complianceDocuments.id,
      docType: complianceDocuments.docType,
      status: complianceDocuments.status,
      expiresAt: complianceDocuments.expiresAt,
      alertSent30d: complianceDocuments.alertSent30d,
      truckId: fleetTrucks.id,
      plate: fleetTrucks.plate,
      fleetId: fleetTrucks.fleetId,
    })
    .from(complianceDocuments)
    .innerJoin(fleetTrucks, eq(fleetTrucks.id, complianceDocuments.truckId))
    .where(
      options.fleetId
        ? and(
            sql`${complianceDocuments.status} in ('expired', 'expiring_soon')`,
            eq(fleetTrucks.fleetId, options.fleetId),
          )
        : sql`${complianceDocuments.status} in ('expired', 'expiring_soon')`,
    );

  const notifyDocIds: string[] = [];

  for (const doc of open) {
    const isExpired = doc.status === 'expired';
    const daysLeft = doc.expiresAt ? daysUntil(doc.expiresAt, now) : 0;
    const message = isExpired
      ? `${label(doc.docType)} expired for ${doc.plate} — truck removed from dispatch`
      : `${label(doc.docType)} for ${doc.plate} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;

    // Upsert on the partial unique index. The DO UPDATE matters: a document
    // that moves expiring_soon → expired must UPGRADE its open alert rather
    // than open a second one, and the countdown in the message has to keep
    // moving as the days tick down. The href deep-links the console to the
    // truck (`/trucks?truck=<id>`), and the DO UPDATE refreshes it so alerts
    // opened before this link existed correct themselves on the next sweep.
    const inserted = await db.execute<{ id: string; inserted: boolean }>(sql`
      insert into alerts (fleet_id, type, severity, message, href, subject_type, subject_id)
      values (
        ${doc.fleetId},
        ${isExpired ? 'doc_expired' : 'doc_expiring'}::alert_type,
        ${isExpired ? 'error' : 'warning'}::alert_severity,
        ${message},
        ${`/trucks?truck=${doc.truckId}`},
        'compliance_document'::alert_subject_type,
        ${doc.docId}
      )
      on conflict ("fleet_id", "type", "subject_id") where "resolved_at" is null
      do update set message = excluded.message, href = excluded.href, updated_at = now()
      returning id, (xmax = 0) as inserted
    `);
    if (inserted[0]?.inserted) result.alertsOpened += 1;

    // A doc that crosses expiring_soon → expired needs its OLD `doc_expiring`
    // alert resolved, or the console shows both at once.
    if (isExpired) {
      await db
        .update(alerts)
        .set({ resolvedAt: now, updatedAt: now })
        .where(
          and(
            eq(alerts.subjectId, doc.docId),
            eq(alerts.type, 'doc_expiring'),
            isNull(alerts.resolvedAt),
          ),
        );
    }

    // Notify once per document per 30-day window. `alert_sent_30d` is the
    // record that a human was told; it is reset in step 7 when the doc goes
    // back to valid, which is what lets next year's expiry notify again.
    if (!doc.alertSent30d && doc.expiresAt) {
      notifyDocIds.push(doc.docId);
      result.notify.push({
        fleetId: doc.fleetId,
        docId: doc.docId,
        truckPlate: doc.plate,
        docType: doc.docType,
        expiresAt: doc.expiresAt,
        daysLeft,
      });
    }
  }

  if (notifyDocIds.length > 0) {
    await db
      .update(complianceDocuments)
      .set({ alertSent30d: true, updatedAt: now })
      .where(sql`${complianceDocuments.id} in ${sqlList(notifyDocIds)}`);
  }

  // 6. Resolve alerts whose document is no longer in trouble (renewed papers).
  const resolved = await db.execute<{ id: string }>(sql`
    update alerts a
    set resolved_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
    from compliance_documents d
    where a.subject_type = 'compliance_document'
      and a.subject_id = d.id
      and a.resolved_at is null
      and d.status = 'valid'
      ${options.fleetId ? sql`and a.fleet_id = ${options.fleetId}` : sql``}
    returning a.id
  `);
  result.alertsResolved = resolved.length;

  // NOTE: Phase 6 also synced failed-payout alerts here, as an explicit
  // stopgap — the dashboard feed had just become stored-only and no payout
  // write path existed to open one at the point of failure. Phase 7 built that
  // path, so this sweep is compliance-only again. `payout_failed` alerts are
  // now opened and resolved by `modules/money/payout-alerts.ts`, and the
  // nightly ledger reconciliation reconciles any that drifted.

  // 7. Reset the notified flag once a document is comfortably valid again, so
  //    the next expiry cycle notifies. Without this a renewed document is
  //    silent forever.
  await db.execute(sql`
    update compliance_documents d
    set alert_sent_30d = false, updated_at = ${now.toISOString()}
    from fleet_trucks t
    where d.truck_id = t.id
      and d.status = 'valid'
      and d.alert_sent_30d = true
      ${fleetScope}
  `);

  return result;
}

/** `in (...)` for a raw fragment; drizzle's inArray needs a column reference. */
function sqlList(values: string[]) {
  return sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}

export { THIRTY_DAYS_MS };
