import { Inject, Injectable } from '@nestjs/common';
import type {
  CustomerAppearance,
  CustomerLanguage,
  CustomerPhotoPresignResponse,
  CustomerProfile,
  CustomerProfileUpdate,
} from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { keyFromFileUrl } from '../../common/storage/file-url';
import { PresignedUploadService } from '../../common/storage/presigned-upload.helper';
import { STORAGE, type StoragePort } from '../../common/storage/storage.port';
import { DB, type Database } from '../../db/db.module';
import { users } from '../../db/schema';

export const CUSTOMER_PHOTO_KEY_PREFIX = 'customer-photos';

/** One day — long enough for a slow client to render the avatar on next launch. */
const PHOTO_GET_TTL_SECONDS = 86_400;

const COLUMNS = {
  id: users.id,
  mobile: users.mobile,
  name: users.name,
  email: users.email,
  photoUrl: users.photoUrl,
  language: users.language,
  appearance: users.appearance,
};

/** `GET/PUT /v1/me` — the customer's own profile (Phase 12). */
@Injectable()
export class MeService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly uploads: PresignedUploadService,
  ) {}

  async getProfile(userId: string): Promise<CustomerProfile> {
    const [row] = await this.db.select(COLUMNS).from(users).where(eq(users.id, userId)).limit(1);

    if (!row) throw ApiException.notFound('Profile not found');
    return this.toProfile(row);
  }

  async updateProfile(userId: string, body: CustomerProfileUpdate): Promise<CustomerProfile> {
    const [updated] = await this.db
      .update(users)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.language !== undefined ? { language: body.language } : {}),
        ...(body.appearance !== undefined ? { appearance: body.appearance } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning(COLUMNS);

    if (!updated) throw ApiException.notFound('Profile not found');
    return this.toProfile(updated);
  }

  /** Mints a slot for the customer's own profile photo. */
  presignPhoto(userId: string): Promise<CustomerPhotoPresignResponse> {
    return this.uploads.presign(CUSTOMER_PHOTO_KEY_PREFIX, userId, 'photo');
  }

  /**
   * Records the uploaded photo. The key must be one this service minted for
   * THIS user — a key from someone else's presign response would otherwise
   * let a customer claim another customer's upload as their avatar.
   */
  async confirmPhoto(userId: string, key: string): Promise<CustomerProfile> {
    if (!this.uploads.isOwnKey(key, CUSTOMER_PHOTO_KEY_PREFIX, userId, 'photo')) {
      throw ApiException.forbidden('This key was not issued to you');
    }

    const [updated] = await this.db
      .update(users)
      .set({ photoUrl: `local://${key}`, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning(COLUMNS);

    if (!updated) throw ApiException.notFound('Profile not found');
    return this.toProfile(updated);
  }

  /**
   * `photoUrl` is stored as `local://<key>`; the client needs a fetchable URL,
   * so a stored local key is presigned on read. Any other non-null value
   * (an external URL, a future `s3://…`) is passed through untouched.
   */
  private async toProfile(row: {
    id: string;
    mobile: string;
    name: string | null;
    email: string | null;
    photoUrl: string | null;
    language: string | null;
    appearance: string | null;
  }): Promise<CustomerProfile> {
    let photoUrl = row.photoUrl;
    if (photoUrl && photoUrl.startsWith('local://')) {
      const presigned = await this.storage.presignGet(
        keyFromFileUrl(photoUrl),
        PHOTO_GET_TTL_SECONDS,
      );
      photoUrl = presigned.url;
    }

    return {
      id: row.id,
      mobile: row.mobile,
      name: row.name,
      email: row.email,
      photoUrl,
      language: row.language as CustomerLanguage | null,
      appearance: row.appearance as CustomerAppearance | null,
    };
  }
}
