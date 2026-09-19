import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Controller, Get, Inject, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiException } from '../../common/errors/api-exception';
import { resolveUploadsPath } from '../../common/storage/resolve-uploads-path';
import { verifyFileSignature } from '../../common/storage/file-signing';
import { ENV, type Env } from '../../config/env';
import { Public } from '../auth/jwt-auth.guard';

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * Uploads a signed PUT may write under. Read access has no such limit — it is
 * gated by the signature alone; this is the extra, independent check for
 * writes, same reasoning as the traversal guard (a valid signature proves the
 * URL wasn't tampered with, not that the key is safe to write). Extend this
 * list alongside any new `PresignedUploadService` key prefix — Phase 12 added
 * `customer-vehicles/` for RC photo uploads.
 */
const PUT_ALLOWED_PREFIXES = ['driver-documents/', 'customer-vehicles/', 'dispute-evidence/'];

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Signed file access (Phase 11, §3.1) — `StoragePort.presignGet`/`presignPut`
 * on the disk adapter point here. `@Public()`: authority comes entirely from
 * the `sig`/`exp` query pair, not from a session, because the whole point is
 * that a browser `<img>` tag or a driver's background upload can hit this
 * directly with no Authorization header to attach.
 */
@Controller('files')
export class FilesController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Public()
  @Get('{*key}')
  async get(@Req() request: Request, @Res() response: Response): Promise<void> {
    const key = extractKey(request);
    this.verify(request, 'GET', key);

    const path = this.safeResolve(key);
    try {
      await stat(path);
    } catch {
      throw ApiException.notFound('File not found');
    }

    response.setHeader(
      'Content-Type',
      CONTENT_TYPE_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream',
    );
    response.setHeader('Cache-Control', 'private, max-age=60');
    await pipeline(createReadStream(path), response);
  }

  @Public()
  @Put('{*key}')
  async put(@Req() request: Request, @Res() response: Response): Promise<void> {
    const key = extractKey(request);
    this.verify(request, 'PUT', key);

    if (!PUT_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      throw ApiException.forbidden('This key is not writable through a presigned PUT');
    }

    const path = this.safeResolve(key);
    await mkdir(dirname(path), { recursive: true });

    let bytesWritten = 0;
    request.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
      if (bytesWritten > MAX_UPLOAD_BYTES) {
        request.destroy(new Error('Upload exceeds the size limit'));
      }
    });

    try {
      await pipeline(request, createWriteStream(path));
    } catch (error) {
      throw ApiException.validation(
        error instanceof Error && error.message.includes('size limit')
          ? 'Upload exceeds the 5MB size limit'
          : 'Upload failed',
      );
    }

    response.status(204).end();
  }

  private verify(request: Request, method: 'GET' | 'PUT', key: string): void {
    const exp = Number(request.query.exp);
    const sig = typeof request.query.sig === 'string' ? request.query.sig : '';

    if (!verifyFileSignature(this.env.FILE_SIGNING_SECRET, method, key, exp, sig)) {
      throw ApiException.forbidden('Signature invalid or expired');
    }
  }

  /**
   * A valid signature proves `key` wasn't tampered with — it says nothing
   * about whether the key is a safe filesystem path. `resolveUploadsPath`
   * catches a traversal key (`../../etc/passwd`) even when its signature
   * checks out; this reports it the same as a plain missing file (404, not
   * 500) so a client learns nothing about *why* it failed.
   */
  private safeResolve(key: string): string {
    try {
      return resolveUploadsPath(this.env.UPLOADS_DIR, key);
    } catch {
      throw ApiException.notFound('File not found');
    }
  }
}

/**
 * `req.path` rather than a Nest wildcard `@Param()` — Express 5's path-to-regexp
 * v8 changed how a named wildcard segment is shaped (array vs string), and this
 * sidesteps that entirely: strip the fixed `/files/` mount prefix and decode
 * whatever remains, the same way `RequestIdMiddleware`'s `'{*splat}'` route in
 * `app.module.ts` avoids depending on that shape.
 */
function extractKey(request: Request): string {
  const marker = '/files/';
  const index = request.path.indexOf(marker);
  if (index === -1) throw ApiException.notFound('File not found');
  const key = decodeURIComponent(request.path.slice(index + marker.length));
  if (!key || key.includes('\0')) throw ApiException.notFound('File not found');
  return key;
}
