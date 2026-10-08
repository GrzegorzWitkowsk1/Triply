const EARTH_RADIUS_M = 6_371_000;

export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return false;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return false;
  }

  return !(lat === 0 && lng === 0);
}

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}
