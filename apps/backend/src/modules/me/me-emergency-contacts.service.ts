import { Inject, Injectable } from '@nestjs/common';
import type {
  EmergencyContact,
  EmergencyContactCreate,
  EmergencyContactUpdate,
} from '@towing/api-contracts';
import { and, eq } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { emergencyContacts } from '../../db/schema';

const COLUMNS = {
  id: emergencyContacts.id,
  name: emergencyContacts.name,
  phone: emergencyContacts.phone,
  relation: emergencyContacts.relation,
};

/** `GET/POST/PUT/DELETE /v1/me/emergency-contacts` (Phase 12) — a hard §13 (SOS) prerequisite. */
@Injectable()
export class MeEmergencyContactsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  list(userId: string): Promise<EmergencyContact[]> {
    return this.db
      .select(COLUMNS)
      .from(emergencyContacts)
      .where(eq(emergencyContacts.userId, userId));
  }

  async create(userId: string, body: EmergencyContactCreate): Promise<EmergencyContact> {
    const [row] = await this.db
      .insert(emergencyContacts)
      .values({ userId, ...body })
      .returning(COLUMNS);
    return row!;
  }

  async update(
    userId: string,
    contactId: string,
    body: EmergencyContactUpdate,
  ): Promise<EmergencyContact> {
    const [row] = await this.db
      .update(emergencyContacts)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(emergencyContacts.id, contactId), eq(emergencyContacts.userId, userId)))
      .returning(COLUMNS);

    if (!row) throw ApiException.notFound('Contact not found');
    return row;
  }

  async remove(userId: string, contactId: string): Promise<void> {
    const [row] = await this.db
      .delete(emergencyContacts)
      .where(and(eq(emergencyContacts.id, contactId), eq(emergencyContacts.userId, userId)))
      .returning({ id: emergencyContacts.id });

    if (!row) throw ApiException.notFound('Emergency contact not found');
  }
}
