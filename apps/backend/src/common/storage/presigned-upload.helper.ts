import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { STORAGE, type StoragePort } from './storage.port';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EXTENSION_SOURCE = '(jpg|jpeg|png|webp)';

/** A randomUUID-suffixed file of an allowed image type — and nothing else. */
const PRESIGNED_KEY_SUFFIX = new RegExp(`^${UUID_SOURCE}\\.${EXTENSION_SOURCE}$`);
/** `<docType>-<uuid>.<ext>` — the file half of a minted key. */
const MINTED_FILE = new RegExp(`^[A-Za-z0-9_-]+-${UUID_SOURCE}\\.${EXTENSION_SOURCE}$`);
const SUBJECT_UUID = new RegExp(`^${UUID_SOURCE}$`);

const DEFAULT_PRESIGN_TTL_SECONDS = 15 * 60;

/**
 * Extensions a minted key may carry. W16 widened this from `.jpg` alone for
 * banner images — a marketing PNG with transparency is not a JPEG — and the
 * `PUT_ALLOWED_PREFIXES` check in `files.controller.ts` is the independent
 * half of the same rule.
 */
export const PRESIGNED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
export type PresignedExtension = (typeof PRESIGNED_EXTENSIONS)[number];

export interface PresignedUploadSlot {
  uploadUrl: string;
  key: string;
  expiresAt: string;
}

/**
 * Presign-then-confirm document uploads. Generalized out of Phase 11's
 * `driver-kyc.service.ts` when Phase 12 added its second consumer: the
 * saved-vehicle RC upload in `modules/me`
 * (`POST /v1/me/vehicles/:id/rc/presign` + `/rc/confirm`), which is what made
 * the extraction worth it. **Profile photos are NOT a consumer** — `PUT /v1/me`
 * takes `photoUrl` as a plain string and no profile-photo upload route exists
 * on either realm; a driver's own profile photo is a plausible third consumer
 * later, not a current one.
 *
 * A key is always `<keyPrefix>/<subjectId>/<docType>-<uuid>.<ext>` — `.jpg`
 * unless a caller asks otherwise (W16's banner images may be PNG or WebP).
 * Confirming a key checks it is EXACTLY that shape for the calling subject
 * and doc type — see `isOwnKey`'s doc comment for why a bare prefix match is
 * not enough.
 */
@Injectable()
export class PresignedUploadService {
  constructor(@Inject(STORAGE) private readonly storage: StoragePort) {}

  async presign(
    keyPrefix: string,
    subjectId: string,
    docType: string,
    ttlSeconds = DEFAULT_PRESIGN_TTL_SECONDS,
    extension: PresignedExtension = '.jpg',
  ): Promise<PresignedUploadSlot> {
    if (!PRESIGNED_EXTENSIONS.includes(extension)) {
      // Typed callers cannot reach this; a JS caller with a hand-built string
      // gets a loud failure rather than a key the PUT-side check would refuse.
      throw new Error(`Unsupported presigned extension: ${extension}`);
    }

    // Server-minted, namespaced under the subject's own id — `isOwnKey` below
    // trusts a key back from the client only because it can check the exact
    // shape minted here, not because the client is assumed honest.
    const key = `${keyPrefix}/${subjectId}/${docType}-${randomUUID()}${extension}`;
    const presigned = await this.storage.presignPut(key, ttlSeconds);
    return { uploadUrl: presigned.url, key: presigned.key, expiresAt: presigned.expiresAt };
  }

  /**
   * A key from someone ELSE's presign response would still carry a valid
   * signature (signatures don't encode who asked for them) — this is the
   * check that stops a subject claiming another subject's uploaded file as
   * their own by replaying its key.
   *
   * A `randomUUID()`-suffixed image file, and NOTHING else — no `/`, no `.`,
   * no `..`. Deliberately stricter than "does it start with the right prefix":
   * `"<prefix>/<id>/selfie-".startsWith` would also accept
   * `"<prefix>/<id>/selfie-../../other/doc-<uuid>.jpg"`, since a traversal
   * segment can sit anywhere AFTER a prefix match and `startsWith` never
   * looks past it. Anchoring the suffix to this exact shape closes that off
   * (found by an adversarial security review during Phase 11, see that
   * phase's "what shipped" record for the failure this once was).
   */
  isOwnKey(key: string, keyPrefix: string, subjectId: string, docType: string): boolean {
    const prefix = `${keyPrefix}/${subjectId}/${docType}-`;
    return key.startsWith(prefix) && PRESIGNED_KEY_SUFFIX.test(key.slice(prefix.length));
  }

  /**
   * A key of the MINTED SHAPE under `keyPrefix`, for ANY subject — the weaker
   * sibling of `isOwnKey`, for resources that belong to the platform rather
   * than to one subject. Banner images are the first case: one admin uploads,
   * any `promo.manage` holder may later edit the row, so pinning the key to
   * the creating admin would lock colleagues out of their own carousel.
   *
   * Same traversal anchoring as `isOwnKey`: exactly
   * `<prefix>/<uuid>/<docType>-<uuid>.<ext>`, one path segment for the
   * subject, one for the file.
   */
  isMintedKey(key: string, keyPrefix: string): boolean {
    const prefix = `${keyPrefix}/`;
    if (!key.startsWith(prefix)) return false;
    const rest = key.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash <= 0 || rest.indexOf('/', slash + 1) !== -1) return false;
    return SUBJECT_UUID.test(rest.slice(0, slash)) && MINTED_FILE.test(rest.slice(slash + 1));
  }
}
