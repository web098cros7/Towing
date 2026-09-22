import type { AccountExportResponse } from '@towing/api-contracts';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/db.module';
import {
  addresses,
  consentRecords,
  drivers,
  emergencyContacts,
  savedVehicles,
  users,
} from '../../db/schema';

/**
 * The §20.4 export builder, shared by the two callers that need it:
 * `GET /v1/me/export` (the subject's own request) and
 * `GET /v1/admin/users/:id/export` (an operator serving an access request for
 * a customer who called instead of opening the app).
 *
 * ONE BUILDER ON PURPOSE. Two implementations of the same legal response is
 * how a customer and the operator acting for them end up looking at different
 * data — and the difference would only be discovered during the dispute it
 * matters for.
 *
 * The driver branch's scope note travels with the code it constrains: KYC
 * images stay out of the bundle (DPDP's access right is over personal data,
 * not over copies of the verification artefacts), which is reversible by
 * adding rows + presigned GETs here if the legal read flips.
 */
export async function buildSubjectExport(
  db: Database,
  subjectType: 'user' | 'driver',
  subjectId: string,
): Promise<AccountExportResponse> {
  const consents = await db
    .select({
      policyType: consentRecords.policyType,
      policyVersion: consentRecords.policyVersion,
      action: consentRecords.action,
      consentedAt: consentRecords.consentedAt,
    })
    .from(consentRecords)
    .where(
      and(eq(consentRecords.subjectType, subjectType), eq(consentRecords.subjectId, subjectId)),
    );

  const consentRows = consents.map((c) => ({
    policyType: c.policyType,
    policyVersion: c.policyVersion,
    // Withdrawals are part of the record a subject is entitled to see, not
    // only the agreements — the export would otherwise show someone consenting
    // twice with no sign they had withdrawn in between.
    action: c.action,
    consentedAt: c.consentedAt.toISOString(),
  })) as AccountExportResponse['consents'];

  if (subjectType === 'driver') {
    const [driver] = await db
      .select({
        id: drivers.id,
        mobile: drivers.mobile,
        name: drivers.name,
        email: drivers.email,
        kycStatus: drivers.kycStatus,
      })
      .from(drivers)
      .where(eq(drivers.id, subjectId))
      .limit(1);

    return { profile: driver ?? null, consents: consentRows };
  }

  const [profile, vehicles, addressRows, contacts] = await Promise.all([
    db
      .select({
        id: users.id,
        mobile: users.mobile,
        name: users.name,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, subjectId))
      .limit(1),
    db
      .select({ id: savedVehicles.id, type: savedVehicles.type, plate: savedVehicles.plate })
      .from(savedVehicles)
      .where(eq(savedVehicles.userId, subjectId)),
    db
      .select({ id: addresses.id, fullAddress: addresses.fullAddress })
      .from(addresses)
      .where(eq(addresses.userId, subjectId)),
    db
      .select({
        id: emergencyContacts.id,
        name: emergencyContacts.name,
        phone: emergencyContacts.phone,
      })
      .from(emergencyContacts)
      .where(eq(emergencyContacts.userId, subjectId)),
  ]);

  return {
    profile: profile[0] ?? null,
    vehicles,
    addresses: addressRows,
    emergencyContacts: contacts,
    consents: consentRows,
  };
}
