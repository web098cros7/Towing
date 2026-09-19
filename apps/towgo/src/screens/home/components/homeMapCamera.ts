import type { LatLng } from '@/types/geo';

/**
 * Camera maths for Home's map: puts the customer's dot on the exact screen
 * point Figma 07 draws it at, and scales the map so the partner lands on (or
 * inside) the point 07 draws the truck at.
 *
 * Works in Web Mercator, which both Google Maps and Apple Maps use: x is
 * longitude in radians, y is `ln(tan(pi/4 + lat/2))`, and a camera is a uniform
 * scale in dp per radian. A region whose aspect ratio equals the viewport's
 * maps onto it exactly, so `animateToRegion` places both points to the dp.
 */

export type ScreenPoint = { x: number; y: number };
export type HomeMapRegion = LatLng & { latitudeDelta: number; longitudeDelta: number };

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export const mercatorY = (latitude: number) =>
  Math.log(Math.tan(Math.PI / 4 + toRad(latitude) / 2));
export const latitudeAt = (y: number) => toDeg(2 * Math.atan(Math.exp(y)) - Math.PI / 2);

/** dp per radian at a Google zoom level (a 256 dp world at zoom 0). */
export const scaleForZoom = (zoom: number) => (256 * 2 ** zoom) / (2 * Math.PI);

const MIN_SCALE = scaleForZoom(3);
const MAX_SCALE = scaleForZoom(18);
/** Used when the partner sits on the customer (no distance to scale by). */
const FALLBACK_SCALE = scaleForZoom(15);

/** The dp per radian a region shows across a view of `width` dp. */
export function scaleOfRegion(region: { longitudeDelta: number }, width: number): number {
  return width / toRad(region.longitudeDelta);
}

export type CameraPlacement = {
  customer: LatLng;
  partner: LatLng | undefined;
  /** The area the camera frames, in dp, from the map view's top-left. */
  viewport: { width: number; height: number };
  /** Where the customer's dot goes inside the viewport. */
  customerAt: ScreenPoint;
  /** Where the route meets the truck inside the viewport. */
  partnerAt: ScreenPoint;
  /**
   * How far the truck may sit from the customer's dot when the partner is not
   * up-and-right of the customer as drawn: dp to the left and below.
   */
  room: { west: number; south: number };
};

/** The region to show, and its scale (dp per radian). */
export function placeCamera({
  customer,
  partner,
  viewport,
  customerAt,
  partnerAt,
  room,
}: CameraPlacement): { region: HomeMapRegion; scale: number } {
  let scale = Number.POSITIVE_INFINITY;
  if (partner) {
    const dx = toRad(partner.longitude - customer.longitude);
    const dy = mercatorY(partner.latitude) - mercatorY(customer.latitude);
    const roomX = Math.max(1, dx >= 0 ? partnerAt.x - customerAt.x : room.west);
    const roomY = Math.max(1, dy >= 0 ? customerAt.y - partnerAt.y : room.south);
    if (Math.abs(dx) > 1e-12) scale = Math.min(scale, roomX / Math.abs(dx));
    if (Math.abs(dy) > 1e-12) scale = Math.min(scale, roomY / Math.abs(dy));
  }
  if (!Number.isFinite(scale)) scale = FALLBACK_SCALE;
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

  const centreX = toRad(customer.longitude) + (viewport.width / 2 - customerAt.x) / scale;
  const centreY = mercatorY(customer.latitude) - (viewport.height / 2 - customerAt.y) / scale;
  const north = latitudeAt(centreY + viewport.height / 2 / scale);
  const south = latitudeAt(centreY - viewport.height / 2 / scale);

  return {
    region: {
      latitude: (north + south) / 2,
      longitude: toDeg(centreX),
      latitudeDelta: north - south,
      longitudeDelta: toDeg(viewport.width / scale),
    },
    scale,
  };
}

/**
 * Geographic bounds that draw a `width` x `height` dp box whose centre is
 * `east` / `north` dp from `anchor`, at `scale`. For `<Overlay bounds>`:
 * `[[north, east], [south, west]]`.
 */
export function boundsAround(
  anchor: LatLng,
  box: { east: number; north: number; width: number; height: number },
  scale: number,
): [[number, number], [number, number]] {
  const centreX = toRad(anchor.longitude) + box.east / scale;
  const centreY = mercatorY(anchor.latitude) + box.north / scale;
  const halfW = box.width / 2 / scale;
  const halfH = box.height / 2 / scale;
  return [
    [latitudeAt(centreY + halfH), toDeg(centreX + halfW)],
    [latitudeAt(centreY - halfH), toDeg(centreX - halfW)],
  ];
}
