import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { AdminContentController } from './admin-content.controller';
import { ContentController } from './content.controller';
import { ContentRepo } from './content.repo';
import { ContentService } from './content.service';

/**
 * W15's FAQ/legal content surface (§9.4.12). One table, two shapes: the public
 * read the apps fetch, and the console's editor.
 */
@Module({
  imports: [AuthModule, AdminAuthModule],
  controllers: [ContentController, AdminContentController],
  providers: [ContentService, ContentRepo],
})
export class ContentModule {}
