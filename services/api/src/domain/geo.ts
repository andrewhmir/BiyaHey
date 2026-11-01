/**
 * Small, dependency-free geometry helpers shared by the routing adapter and
 * the search endpoint.
 *
 * Coordinates are `[lat, lon]` pairs in degrees; distances are metres.
 */

const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two `[lat, lon]` pairs, in metres. */
export function haversineM(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dLat = toRadians(b[0] - a[0]);
  const dLon = toRadians(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a[0])) * Math.cos(toRadians(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
