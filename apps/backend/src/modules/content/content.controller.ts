import { Controller, Get, Header } from '@nestjs/common';
import {
  contentPageKindSchema,
  type ContentPageKind,
  type ContentPagesResponse,
} from '@towing/api-contracts';
import { z } from 'zod';
import { ZodParam } from '../../common/validation/zod.decorators';
import { Public } from '../auth/jwt-auth.guard';
import { ContentService } from './content.service';

/**
 * `GET /v1/content/:kind` — the FAQ and legal pages the apps read (§9.4.12).
 *
 * PUBLIC, like `GET /v1/app-config` and for a related reason: Help and Legal
 * are reachable before anybody signs in (the login footer links there), and a
 * content read that demanded a session would make the legal copy unreachable
 * at exactly the moment a user is asked to accept it.
 *
 * PUBLISHED PAGES ONLY. `isPublished: false` is the console's draft state and
 * the public route must not serve it — an operator writing next week's Terms
 * before the version bump should not leak them early.
 */
@Controller('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get(':kind')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  list(
    @ZodParam(contentPageKindSchema, 'kind') kind: ContentPageKind,
  ): Promise<ContentPagesResponse> {
    return this.content.published(kind);
  }
}
