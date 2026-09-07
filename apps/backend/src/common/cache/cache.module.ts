import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { RedisLock } from './redis-lock';

@Global()
@Module({
  providers: [CacheService, RedisLock],
  exports: [CacheService, RedisLock],
})
export class CacheModule {}
