import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type {
  OpsBookingCreatedEvent,
  OpsBookingStatusEvent,
  OpsSosAlertEvent,
} from '@towing/api-contracts';
import { OPS_EVENTS_CHANNEL, REDIS } from '../../redis/redis.constants';

/** Any ops event without its timestamp — the service stamps `at`. */
type PublishableOpsEvent =
  | Omit<OpsBookingStatusEvent, 'at'>
  | Omit<OpsBookingCreatedEvent, 'at'>
  | Omit<OpsSosAlertEvent, 'at'>;

/**
 * The platform-wide half of the event fan-out (A18).
 *
 * `FleetEventsService` answers "what moved for THIS fleet" — tenancy-scoped,
 * cache-invalidating, consumed by one console. This answers "what moved,
 * period" for the admin console, which watches the marketplace rather than a
 * tenant: every booking status change, regardless of fleet. Same disciplines
 * as its sibling — publish is warn-only and must never fail the mutation that
 * caused it — but no cache invalidation: there is no per-tenant dashboard to
 * bust here (per-admin badge caches arrive in W1, reading this channel).
 */
@Injectable()
export class OpsEventsService {
  private readonly logger = new Logger(OpsEventsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(event: PublishableOpsEvent): Promise<void> {
    try {
      await this.redis.publish(
        OPS_EVENTS_CHANNEL,
        JSON.stringify({ ...event, at: new Date().toISOString() }),
      );
    } catch (err) {
      this.logger.warn(
        `ops event publish failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
