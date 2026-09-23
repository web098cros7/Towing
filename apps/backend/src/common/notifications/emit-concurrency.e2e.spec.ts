import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../test/app';
import { seedDriver, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';
import { NotificationService } from './notification.service';

/**
 * A burst of notifications must not freeze the API.
 *
 * FOUND BY `pnpm bench:payments` (24 Sep): fifty customers paying at once
 * left ten database connections "idle in transaction" for minutes and every
 * later request hanging. `emit` writes the event inside a transaction and
 * resolves the recipients inside it too — but the resolver queried through
 * its OWN pool connection. Each emit held one connection and waited for a
 * second, so as many simultaneous emits as the pool has connections (10)
 * deadlocked the pool for good. Every notification in the product goes
 * through here, so a busy minute would have stopped the whole API.
 *
 * The burst below is more than the pool can hold at once; it has to finish.
 */
describe('NotificationService.emit under a burst', () => {
  let app: INestApplication;
  let db: TestDatabase;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await truncateAll();
    await flushTestRedis();
  });

  it('finishes 25 simultaneous emits that each resolve a recipient', async () => {
    const driverId = await seedDriver(db, { name: 'Busy Driver' });
    const notifications = app.get(NotificationService);

    const burst = Promise.all(
      Array.from({ length: 25 }, () =>
        notifications.emit('earnings.credited', {
          bookingId: randomUUID(),
          driverId,
          amount: '₹100.00',
        }),
      ),
    );
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('emit burst deadlocked the pool')), 15_000),
    );

    await expect(Promise.race([burst, deadline])).resolves.toHaveLength(25);

    const [row] = (await db.execute(sql`
      select count(*)::int as n from notification_events where event = 'earnings.credited'
    `)) as unknown as [{ n: number }];
    expect(row.n).toBe(25);
  }, 30_000);
});
