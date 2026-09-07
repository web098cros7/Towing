import { PUBLIC_TRACK_FIELDS, publicTrackSchema } from '@towing/api-contracts';
import { describe, expect, it } from 'vitest';
import { toPublicTrack, toBookingTracking } from './tracking.mapper';
import type { TrackingBookingRow } from './tracking.repo';

/**
 * §11.7's acceptance criterion, enforced: "Share links carry no PII beyond first
 * name + plate".
 *
 * THIS IS THE MOST IMPORTANT TEST IN THE PHASE, and it is worth saying why in a
 * file that will be read by whoever next adds a field to a booking DTO.
 *
 * `GET /v1/track/:shareToken` is the only unauthenticated read of a booking in
 * the system. It is reachable by anyone holding a link that was forwarded through
 * WhatsApp, screenshotted, or pasted into a group chat — and unlike every other
 * customer route there is no session, no ownership check and no realm behind it.
 * The token is the whole credential.
 *
 * The projection is therefore an ALLOWLIST rather than a redaction, and this test
 * is what keeps it one. A `.omit()`-derived schema inherits every field added
 * upstream: the day somebody adds a phone number to `bookingDetailSchema` — a
 * perfectly reasonable thing to do — an omit list that was not updated in the
 * same commit starts publishing it to the open internet, silently, with no test
 * failing. Here, a new field is invisible until somebody types it into
 * `publicTrackSchema` AND into `PUBLIC_TRACK_FIELDS`, at which point this fails
 * and they have to mean it.
 */

/**
 * A row carrying every dangerous field the real table has, so the mapper is
 * exercised against exactly what it must not publish.
 */
const row: TrackingBookingRow = {
  id: '3f9a21b4-0000-4000-8000-000000000001',
  userId: '3f9a21b4-0000-4000-8000-000000000002',
  status: 'en_route',
  driverId: '3f9a21b4-0000-4000-8000-000000000003',
  pickupLat: 12.97161234,
  pickupLng: 77.59461234,
  dropLat: 12.9352,
  dropLng: 77.6245,
  routePolyline: '_p~iF~ps|U',
  routeDropPolyline: '_ulLnnqC',
  routeSource: 'google_directions',
  etaSeconds: 480,
  etaUpdatedAt: new Date('2026-09-03T10:00:00.000Z'),
  shareToken: 'abcdefghijklmnop',
  shareExpiresAt: null,
  arrivedAt: null,
  startedAt: null,
  completedAt: null,
  updatedAt: new Date('2026-09-03T10:00:00.000Z'),
  driverName: 'Ramesh Kumar Iyer',
  driverPhotoUrl: 'https://example.test/photo.jpg',
  driverRating: '4.80',
  driverTotalTrips: 128,
  driverMobile: '+919876543210',
  driverVehicleClass: 'flatbed',
  driverLastPingAt: new Date('2026-09-03T10:00:00.000Z'),
  truckPlate: 'KA 03 AB 1234',
};

const fix = { lat: 12.98765432, lng: 77.61234567, lastPingAt: new Date('2026-09-03T10:00:05.000Z') };
const now = new Date('2026-09-03T10:00:10.000Z');

describe('§11.7 public share projection', () => {
  it('publishes exactly the allowlisted keys and nothing else', () => {
    const projection = toPublicTrack(row, fix, now);
    expect(Object.keys(projection).sort()).toEqual([...PUBLIC_TRACK_FIELDS].sort());
  });

  it('satisfies its own schema in strict mode', () => {
    // `.strict()` makes an unexpected key a parse ERROR rather than a silently
    // stripped one — the difference between "we did not send it" and "we sent it
    // and zod threw it away after serialisation".
    expect(() => publicTrackSchema.strict().parse(toPublicTrack(row, fix, now))).not.toThrow();
  });

  it('leaks no phone number anywhere in the serialised body', () => {
    // Serialised and searched as text, not field by field: a nested object added
    // later would slip past a per-key assertion.
    const body = JSON.stringify(toPublicTrack(row, fix, now));
    expect(body).not.toContain('9876543210');
    expect(body).not.toContain('+91');
  });

  it('publishes a first name only, never a surname', () => {
    const projection = toPublicTrack(row, fix, now);
    expect(projection.driverFirstName).toBe('Ramesh');

    const body = JSON.stringify(projection);
    expect(body).not.toContain('Kumar');
    expect(body).not.toContain('Iyer');
  });

  it('leaks no internal identifier that could be used against another route', () => {
    const body = JSON.stringify(toPublicTrack(row, fix, now));
    expect(body).not.toContain(row.id);
    expect(body).not.toContain(row.userId);
    expect(body).not.toContain(row.driverId!);
    // The token itself is deliberately absent too: the viewer already has it,
    // and echoing it into a page body puts it into screenshots and referrers.
    expect(body).not.toContain(row.shareToken!);
  });

  it('coarsens the driver position to a stable ~100 m grid', () => {
    const projection = toPublicTrack(row, fix, now);

    // Snapped, not merely rounded for display: three decimal places is ~110 m.
    expect(projection.position!.lat).toBe(12.988);
    expect(projection.position!.lng).toBe(77.612);
    expect(projection.position!.lat).not.toBe(fix.lat);
  });

  it('coarsens with a fixed grid so repeated polling cannot average back the truth', () => {
    // The reason it is a grid and not jitter. Random noise re-rolls per request,
    // so a viewer sampling for a minute recovers the real position by averaging;
    // a grid returns the identical cell every time and no amount of sampling
    // gets finer than the cell.
    const first = toPublicTrack(row, fix, now);
    const second = toPublicTrack(row, fix, new Date(now.getTime() + 10_000));
    expect(second.position).toMatchObject({
      lat: first.position!.lat,
      lng: first.position!.lng,
    });
  });

  it('coarsens the pickup area too — never the exact customer address', () => {
    const projection = toPublicTrack(row, fix, now);
    expect(projection.pickupArea).toEqual({ lat: 12.972, lng: 77.595 });
    expect(projection.pickupArea!.lat).not.toBe(row.pickupLat);
  });

  it('publishes the pickup leg only, never the route to the drop', () => {
    // The drop is the customer's destination — a fact about them, not about the
    // truck the viewer was invited to watch.
    const projection = toPublicTrack(row, fix, now);
    expect(projection.routePolyline).toBe(row.routePolyline);
    expect(JSON.stringify(projection)).not.toContain(row.routeDropPolyline!);
  });

  it('survives a booking with no driver, no fix and no route', () => {
    const bare: TrackingBookingRow = {
      ...row,
      driverId: null,
      driverName: null,
      truckPlate: null,
      routePolyline: null,
      etaSeconds: null,
      status: 'searching',
    };
    const projection = toPublicTrack(bare, undefined, now);

    expect(projection.driverFirstName).toBeNull();
    expect(projection.position).toBeNull();
    expect(() => publicTrackSchema.strict().parse(projection)).not.toThrow();
  });

  it('handles a single-word driver name without producing an empty string', () => {
    const projection = toPublicTrack({ ...row, driverName: 'Ramesh' }, fix, now);
    expect(projection.driverFirstName).toBe('Ramesh');

    const blank = toPublicTrack({ ...row, driverName: '   ' }, fix, now);
    expect(blank.driverFirstName).toBeNull();
  });
});

describe("the customer's own tracking payload", () => {
  it('carries the full-precision position, unlike the public one', () => {
    // The contrast is the point: this caller has proved ownership, so coarsening
    // here would be privacy theatre that made the map wrong.
    const tracking = toBookingTracking(row, fix, now);
    expect(tracking.position!.lat).toBe(fix.lat);
    expect(tracking.position!.lng).toBe(fix.lng);
  });

  it('still carries no phone number — that is a separate, guarded route', () => {
    // §9.1.7's call button goes through `GET /bookings/:id/contact` and
    // `TelephonyPort`, so the number is never a field on a polled payload that
    // sits in a query cache and a HAR file every ten seconds.
    const body = JSON.stringify(toBookingTracking(row, fix, now));
    expect(body).not.toContain('9876543210');
  });

  it('reports a live share link and an expired one differently', () => {
    expect(toBookingTracking(row, fix, now).shared).toBe(true);

    const expired = { ...row, shareExpiresAt: new Date(now.getTime() - 1_000) };
    expect(toBookingTracking(expired, fix, now).shared).toBe(false);

    const never = { ...row, shareToken: null };
    expect(toBookingTracking(never, fix, now).shared).toBe(false);
  });
});
