import { Module } from '@nestjs/common';
import { AppConfigController } from './app-config.controller';
import { AppConfigRepo } from './app-config.repo';

/**
 * W12's public config surface. One route, one cached reader.
 *
 * Exported so `AdminConfigModule` can reuse `AppConfigRepo` for the admin read
 * and invalidate it after a write: the banner the console previews and the
 * banner the handsets fetch must be the same object, not two mappings that
 * agree today.
 */
@Module({
  controllers: [AppConfigController],
  providers: [AppConfigRepo],
  exports: [AppConfigRepo],
})
export class AppConfigModule {}
