import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { geographyPoint } from '../geography';
import { primaryId, timestamps } from './columns';
import { complianceDocTypeEnum, complianceStatusEnum, truckStatusEnum, vehicleClassEnum } from './enums';
import { fleets } from './fleets';

/** Fleet-owned tow trucks (§17 FLEETS). */
export const fleetTrucks = pgTable(
  'fleet_trucks',
  {
    id: primaryId(),
    fleetId: uuid('fleet_id')
      .notNull()
      .references(() => fleets.id, { onDelete: 'cascade' }),
    type: vehicleClassEnum('type').notNull(),
    plate: text('plate').notNull(),
    capacity: text('capacity'),
    // Figma 18/20's vehicle card: the truck's make and model. Nullable: fleets fill them in.
    make: text('make'),
    model: text('model'),
    currentLocation: geographyPoint('current_location'),
    lastPingAt: timestamp('last_ping_at', { withTimezone: true }),
    // `non_compliant` is what excludes a truck from dispatch (§3.2).
    status: truckStatusEnum('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    // GIST on current_location is added in the migration.
    index('idx_fleet_trucks_fleet').on(t.fleetId),
    index('idx_fleet_trucks_status').on(t.fleetId, t.status),
  ],
);

/**
 * Insurance/RC/PUC/permit papers per truck (§17). The console's compliance
 * board reads these by expiry, so a partial index on active rows carries the
 * "expiring in 30 days" query.
 */
export const complianceDocuments = pgTable(
  'compliance_documents',
  {
    id: primaryId(),
    truckId: uuid('truck_id')
      .notNull()
      .references(() => fleetTrucks.id, { onDelete: 'cascade' }),
    docType: complianceDocTypeEnum('doc_type').notNull(),
    fileUrl: text('file_url'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    alertSent30d: boolean('alert_sent_30d').notNull().default(false),
    status: complianceStatusEnum('status').notNull().default('valid'),
    ...timestamps,
  },
  (t) => [index('idx_compliance_documents_truck').on(t.truckId)],
);
