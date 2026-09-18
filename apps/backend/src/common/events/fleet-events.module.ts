import { Global, Module } from '@nestjs/common';
import { FleetEventsService } from './fleet-events.service';
import { OpsEventsService } from './ops-events.service';

/** Global for the same reason CacheModule is: every mutation path needs it. */
@Global()
@Module({
  providers: [FleetEventsService, OpsEventsService],
  exports: [FleetEventsService, OpsEventsService],
})
export class FleetEventsModule {}
