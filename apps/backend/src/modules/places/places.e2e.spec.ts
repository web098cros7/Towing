import type { INestApplication } from '@nestjs/common';
import {
  decodePolyline,
  placeRouteResponseSchema,
  type PlaceAutocompleteResponse,
  type PlaceDetail,
} from '@towing/api-contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serviceZones } from '../../db/schema';
import { createTestApp, customerAuthHeaderFor, driverAuthHeaderFor } from '../../test/app';
import { expectMatchesContract } from '../../test/contracts';
import {
  seedCustomer,
  seedDriver,
  setupTestDatabase,
  testDb,
  truncateAll,
  type TestDatabase,
} from '../../test/db';
import { closeTestRedis, flushTestRedis } from '../../test/redis';

/**
 * `GET /v1/places/*` (§9.1.5) — the routes that finally let a customer type an
 * address instead of picking from seven presets.
 *
 * Everything here runs on the LOCAL GAZETTEER, because that is what a
 * zero-credential deployment runs and there is no Places key
 * (SETUP-CHECKLIST item 7). The google → local degrade is proven separately in
 * `geocoding-fallback.spec.ts` by tripping the breaker.
 */

let app: INestApplication;
let db: TestDatabase;
let auth: string;

async function seedZones(): Promise<void> {
  await db.insert(serviceZones).values([
    {
      name: 'Bengaluru Metro',
      area: 'SRID=4326;POLYGON((77.45 12.80,77.80 12.80,77.80 13.15,77.45 13.15,77.45 12.80))',
    },
    {
      name: 'Chennai Metro',
      area: 'SRID=4326;POLYGON((80.05 12.85,80.32 12.85,80.32 13.15,80.05 13.15,80.05 12.85))',
    },
  ]);
}

async function autocomplete(q: string, extra = ''): Promise<PlaceAutocompleteResponse> {
  const res = await request(app.getHttpServer())
    .get(`/v1/places/autocomplete?q=${encodeURIComponent(q)}${extra}`)
    .set('Authorization', auth)
    .expect(200);
  return res.body as PlaceAutocompleteResponse;
}

async function details(placeId: string): Promise<PlaceDetail> {
  const res = await request(app.getHttpServer())
    .get(`/v1/places/details?placeId=${encodeURIComponent(placeId)}`)
    .set('Authorization', auth)
    .expect(200);
  return res.body as PlaceDetail;
}

async function reverse(lat: number, lng: number): Promise<PlaceDetail> {
  const res = await request(app.getHttpServer())
    .get(`/v1/places/reverse?lat=${lat}&lng=${lng}`)
    .set('Authorization', auth)
    .expect(200);
  return res.body as PlaceDetail;
}

describe('places', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    db = testDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll();
    // The autocomplete cache is keyed on the query, not on the database, so a
    // stale entry would survive a truncate and answer a later case's zone check.
    await flushTestRedis();
    auth = await customerAuthHeaderFor(app, { userId: await seedCustomer(db) });
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  describe('autocomplete', () => {
    it('returns predictions from the local gazetteer and labels the source', async () => {
      await seedZones();
      const body = await autocomplete('indira');

      expect(body.source).toBe('local');
      expect(body.predictions.length).toBeGreaterThan(0);
      expect(body.predictions[0]).toMatchObject({
        primary: 'Indiranagar',
        secondary: '100 Feet Road, Bengaluru',
      });
      // `local:` prefixed so an id can never be mistaken for — or fed to —
      // Google's.
      expect(body.predictions[0]!.placeId.startsWith('local:')).toBe(true);
    });

    it('carries NO coordinate on a prediction', async () => {
      // By design and by Google's terms: resolving a coordinate costs a second
      // billed call, so it happens once when the customer picks a row, not for
      // every keystroke's worth of suggestions.
      await seedZones();
      const body = await autocomplete('koram');
      expect(Object.keys(body.predictions[0]!).sort()).toEqual(['placeId', 'primary', 'secondary']);
    });

    it('matches an alias people actually type', async () => {
      await seedZones();
      const body = await autocomplete('bangalore airport');
      expect(body.predictions[0]?.primary).toBe('Kempegowda Intl. Airport');
    });

    it('biases towards the caller without filtering others out', async () => {
      await seedZones();
      // "a" matches places in both cities; from Chennai the Chennai ones should
      // sort first, but Bengaluru must still be reachable.
      const fromChennai = await autocomplete('nagar', '&lat=13.0827&lng=80.2707');
      expect(fromChennai.predictions[0]?.secondary).toContain('Chennai');
      expect(fromChennai.predictions.length).toBeGreaterThan(0);
    });

    it('returns an empty list rather than an error for an unknown place', async () => {
      await seedZones();
      const body = await autocomplete('zzzzznowhere');
      expect(body.predictions).toEqual([]);
    });

    it('422s a query too short to be worth a vendor call', async () => {
      await request(app.getHttpServer())
        .get('/v1/places/autocomplete?q=a')
        .set('Authorization', auth)
        .expect(422);
    });
  });

  describe('details', () => {
    it('resolves a prediction to a coordinate and its service zone', async () => {
      await seedZones();
      const [prediction] = (await autocomplete('indira')).predictions;

      const detail = await details(prediction!.placeId);

      expect(detail.point.lat).toBeCloseTo(12.9784, 4);
      expect(detail.point.lng).toBeCloseTo(77.6408, 4);
      expect(detail.zoneName).toBe('Bengaluru Metro');
      expect(detail.source).toBe('local');
    });

    it('reports zone null for a place outside every service area', async () => {
      // The airport sits north of the seeded polygon's 13.15 edge. Telling the
      // customer at SELECTION time is the whole reason the zone is resolved
      // here — otherwise they build a booking and take a 422 at the fare sheet.
      await seedZones();
      const [prediction] = (await autocomplete('kempegowda intl')).predictions;

      const detail = await details(prediction!.placeId);

      expect(detail.zoneId).toBeNull();
      expect(detail.zoneName).toBeNull();
    });

    it('re-resolves the zone even on a cache hit', async () => {
      // The vendor answer is cached for a day; the zone is not. An admin
      // redrawing a service area must take effect immediately, not tomorrow.
      const [prediction] = (await autocomplete('indira')).predictions;
      expect((await details(prediction!.placeId)).zoneName).toBeNull();

      await seedZones();
      expect((await details(prediction!.placeId)).zoneName).toBe('Bengaluru Metro');
    });

    it('404s an id nothing owns', async () => {
      await request(app.getHttpServer())
        .get('/v1/places/details?placeId=local:not-a-real-place')
        .set('Authorization', auth)
        .expect(404);
    });
  });

  describe('reverse — the draggable pin', () => {
    it('labels a pin with the nearest locality and keeps the PIN’s coordinate', async () => {
      await seedZones();
      // ~400 m from Indiranagar's centroid.
      const detail = await reverse(12.9788, 77.6444);

      expect(detail.label).toBe('Indiranagar');
      // The customer dragged to a specific point and the fare is measured from
      // it; snapping to the locality centroid would silently move the pickup.
      expect(detail.point).toEqual({ lat: 12.9788, lng: 77.6444 });
      expect(detail.zoneName).toBe('Bengaluru Metro');
    });

    it('falls back to the bare coordinate in open country', async () => {
      // Past the 3 km cut-off. Without it a pin here would be labelled with
      // whichever of twenty-one localities is least far away — possibly 60 km
      // off — and the customer would confirm a pickup named after a place they
      // are nowhere near.
      await seedZones();
      const detail = await reverse(12.5000, 77.2000);

      expect(detail.label).toMatch(/^12\.50000, 77\.20000$/);
      expect(detail.zoneId).toBeNull();
    });

    it('never fails — a pin always lands somewhere', async () => {
      await seedZones();
      const detail = await reverse(0, 0);
      expect(detail.point).toEqual({ lat: 0, lng: 0 });
      expect(detail.address.length).toBeGreaterThan(0);
    });

    it('422s an out-of-range coordinate', async () => {
      await request(app.getHttpServer())
        .get('/v1/places/reverse?lat=200&lng=0')
        .set('Authorization', auth)
        .expect(422);
    });
  });

  describe('route', () => {
    const url = '/v1/places/route?fromLat=12.9352&fromLng=77.6245&toLat=12.9784&toLng=77.6408';

    it('returns the line between two points, and says when it is a straight one', async () => {
      const res = await request(app.getHttpServer()).get(url).set('Authorization', auth).expect(200);
      const body = expectMatchesContract(placeRouteResponseSchema, res.body);
      // Tests run on the offline adapters (test/setup.ts): a straight, labelled line.
      expect(body.source).toBe('haversine');
      const points = decodePolyline(body.polyline);
      expect(points.length).toBeGreaterThanOrEqual(2);
      expect(points[0]!.lat).toBeCloseTo(12.9352, 4);
      expect(points.at(-1)!.lng).toBeCloseTo(77.6408, 4);
      expect(body.distanceMeters).toBeGreaterThan(4000);
    });

    it('401s without a token — Directions spends vendor quota', async () => {
      await request(app.getHttpServer()).get(url).expect(401);
    });

    it('422s a missing end point', async () => {
      await request(app.getHttpServer())
        .get('/v1/places/route?fromLat=12.9&fromLng=77.6')
        .set('Authorization', auth)
        .expect(422);
    });
  });

  describe('access', () => {
    it('401s without a token — this route spends vendor quota', async () => {
      await request(app.getHttpServer()).get('/v1/places/autocomplete?q=indira').expect(401);
    });

    it('serves the driver realm too', async () => {
      await seedZones();
      const driverId = await seedDriver(db, { kycStatus: 'approved' });
      await request(app.getHttpServer())
        .get('/v1/places/autocomplete?q=indira')
        .set('Authorization', await driverAuthHeaderFor(app, { driverId }))
        .expect(200);
    });
  });
});
