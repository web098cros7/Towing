import type { INestApplication } from '@nestjs/common';
import { adminContentPagesResponseSchema, contentPagesResponseSchema } from '@towing/api-contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActions } from '../../db/schema';
import { contentPages } from '../../db/schema/support';
import { adminAuthHeaderFor, createTestApp } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import { seedAdmin, setupTestDatabase, truncateAll, type TestDatabase } from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

/**
 * W15 — FAQ/legal content (`GET /v1/content/:kind`, `/v1/admin/content`).
 *
 * The two halves of the rule: the PUBLIC route serves published pages in
 * display order and nothing else (a draft must not leak); the CONSOLE route
 * sees everything and every write lands an audited `content.update` with the
 * full before/after — a legal page is exactly what somebody later audits.
 */
describe('content pages (/v1/content + /v1/admin/content, W15)', () => {
  let app: INestApplication;
  let db: TestDatabase;
  let opsAuth: string;
  let supportAuth: string;
  let financeAuth: string;

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

    opsAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'operations' })).id,
      subRole: 'operations',
    });
    supportAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'support' })).id,
      subRole: 'support',
    });
    financeAuth = await adminAuthHeaderFor(app, {
      adminId: (await seedAdmin(db, { subRole: 'finance' })).id,
      subRole: 'finance',
    });

    await db.insert(contentPages).values([
      {
        slug: 'second-faq',
        kind: 'faq',
        title: 'Second question',
        bodyMd: 'The second answer.',
        sortOrder: 2,
      },
      {
        slug: 'first-faq',
        kind: 'faq',
        title: 'First question',
        bodyMd: 'The first answer.',
        sortOrder: 1,
      },
      {
        slug: 'draft-faq',
        kind: 'faq',
        title: 'Draft question',
        bodyMd: 'Not ready for anybody to read.',
        sortOrder: 3,
        isPublished: false,
      },
      {
        slug: 'privacy-policy',
        kind: 'legal',
        title: 'Privacy Policy',
        bodyMd: 'Seeded legal copy.',
        sortOrder: 1,
      },
    ]);
  });

  it('serves published pages in order, with no session and a cache header', async () => {
    const res = await request(app.getHttpServer()).get('/v1/content/faq').expect(200);
    expect(res.headers['cache-control']).toContain('public');

    const parsed = expectMatchesContract(contentPagesResponseSchema, res.body);
    expect(parsed.items.map((page) => page.slug)).toEqual(['first-faq', 'second-faq']);
    expect(parsed.items[0]!.bodyMd).toBe('The first answer.');
  });

  it('never serves a draft, and never mixes kinds', async () => {
    const faq = await request(app.getHttpServer()).get('/v1/content/faq').expect(200);
    expect(faq.body.items.map((page: { slug: string }) => page.slug)).not.toContain('draft-faq');

    const legal = await request(app.getHttpServer()).get('/v1/content/legal').expect(200);
    expect(legal.body.items.map((page: { slug: string }) => page.slug)).toEqual(['privacy-policy']);
  });

  it('refuses a kind the contract does not know', async () => {
    await request(app.getHttpServer()).get('/v1/content/promos').expect(422);
  });

  it('shows the console everything, drafts included', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/admin/content')
      .set('Authorization', opsAuth)
      .expect(200);
    const parsed = expectMatchesContract(adminContentPagesResponseSchema, res.body);
    expect(parsed.items).toHaveLength(4);
    expect(parsed.items.find((page) => page.slug === 'draft-faq')!.isPublished).toBe(false);
  });

  it('upserts a page, audits both halves, and honours the publish toggle', async () => {
    const create = await request(app.getHttpServer())
      .put('/v1/admin/content/towing-checklist')
      .set('Authorization', supportAuth)
      .send({
        kind: 'faq',
        title: 'What should I keep in the car?',
        bodyMd: 'A reflective triangle and a torch.',
        isPublished: true,
        sortOrder: 9,
      })
      .expect(200);
    expect(create.body.slug).toBe('towing-checklist');
    expect(create.body.isPublished).toBe(true);

    const update = await request(app.getHttpServer())
      .put('/v1/admin/content/towing-checklist')
      .set('Authorization', opsAuth)
      .send({
        kind: 'faq',
        title: 'What should I keep in the car?',
        bodyMd: 'A reflective triangle, a torch, and water.',
        isPublished: false,
        sortOrder: 9,
      })
      .expect(200);
    expect(update.body.isPublished).toBe(false);

    // Unpublished at the second write → gone from the public read.
    const publicFaq = await request(app.getHttpServer()).get('/v1/content/faq').expect(200);
    expect(publicFaq.body.items.map((page: { slug: string }) => page.slug)).not.toContain(
      'towing-checklist',
    );

    const audits = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'content.update'));
    expect(audits).toHaveLength(2);
    // The second write's `before` holds the first write's row.
    expect((audits[1]!.before as { title: string }).title).toContain('What should I keep');
    expect((audits[1]!.after as { isPublished: boolean }).isPublished).toBe(false);
  });

  it('keeps finance out and lets operations and support edit (§4.2)', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/content')
      .set('Authorization', financeAuth)
      .expect(403);

    await request(app.getHttpServer())
      .put('/v1/admin/content/faq-retry')
      .set('Authorization', financeAuth)
      .send({
        kind: 'faq',
        title: 'Nope',
        bodyMd: 'Nope.',
        isPublished: true,
        sortOrder: 0,
      })
      .expect(403);

    await request(app.getHttpServer())
      .get('/v1/admin/content/faq-retry')
      .set('Authorization', opsAuth)
      .expect(404);
  });
});
