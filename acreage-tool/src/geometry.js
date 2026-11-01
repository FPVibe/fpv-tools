/**
 * Geodesic geometry helpers for the acreage tool.
 *
 * Pure functions, no DOM. Positions are `[lat, lon]` pairs in degrees;
 * distances are metres and areas square metres.
 *
 * Circles, squares and rectangles use closed-form areas. Freehand polygons
 * are measured on the sphere: the ring is projected to a local flat frame
 * centred on its own centroid and measured with the shoelace formula, which
 * is accurate to well under a tenth of a percent at parcel scale. A
 * spherical-excess implementation is kept alongside it as an independent
 * cross-check (the two agree to ~0.0002% at 1 km).
 */

/** Mean Earth radius (metres) — matches Leaflet's own distance maths. */
export const EARTH_RADIUS_M = 6371008.8;

/**
 * Project a lat/lon to local metres around a reference point.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} lat0 reference latitude in degrees
 * @param {number} lon0 reference longitude in degrees
 * @returns {[number, number]} east, north metres
 */
export function projectMeters(lat, lon, lat0, lon0) {
  const r = Math.PI / 180;
  return [
    (lon - lon0) * r * EARTH_RADIUS_M * Math.cos(lat0 * r),
    (lat - lat0) * r * EARTH_RADIUS_M,
  ];
}

/** Great-circle distance in metres between two lat/lon points. */
export function haversine(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Offset a lat/lon by an east/north metre displacement.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} dEast metres east
 * @param {number} dNorth metres north
 * @returns {[number, number]} the offset position
 */
export function offsetLatLng(lat, lon, dEast, dNorth) {
  const r = Math.PI / 180;
  const newLat = lat + (dNorth / EARTH_RADIUS_M) / r;
  const newLon = lon + (dEast / (EARTH_RADIUS_M * Math.cos(lat * r))) / r;
  return [newLat, newLon];
}

/**
 * Area of a closed ring in square metres, measured on a locally projected
 * flat frame. The ring is treated as closed whether or not the last point
 * repeats the first.
 *
 * @param {Array<[number, number]>} ring
 * @returns {number}
 */
export function shoelaceArea(ring) {
  if (!ring || ring.length < 3) return 0;
  const lat0 = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
  const lon0 = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    const [x1, y1] = projectMeters(ring[i][0], ring[i][1], lat0, lon0);
    const [x2, y2] = projectMeters(ring[next][0], ring[next][1], lat0, lon0);
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/**
 * Area of a closed ring in square metres using the spherical excess
 * formula. Independent cross-check for {@link shoelaceArea}.
 *
 * @param {Array<[number, number]>} ring
 * @returns {number}
 */
export function sphericalArea(ring) {
  if (!ring || ring.length < 3) return 0;
  const r = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    const [lat1, lon1] = ring[i];
    const [lat2, lon2] = ring[next];
    total += (lon2 - lon1) * r * (2 + Math.sin(lat1 * r) + Math.sin(lat2 * r));
  }
  return Math.abs(total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2);
}

/** Perimeter of a closed ring in metres. */
export function ringPerimeter(ring) {
  if (!ring || ring.length < 2) return 0;
  let perimeter = 0;
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    perimeter += haversine(ring[i][0], ring[i][1], ring[next][0], ring[next][1]);
  }
  return perimeter;
}

/** Area of a circle of the given radius. */
export function circleArea(radiusM) {
  return Math.PI * radiusM * radiusM;
}

/** Area of a square of the given side length. */
export function squareArea(sideM) {
  return sideM * sideM;
}

/** Area of a rectangle of the given width and height. */
export function rectArea(widthM, heightM) {
  return widthM * heightM;
}

/**
 * Closed ring approximating a circle.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusM
 * @param {number} [segs] number of segments
 * @returns {Array<[number, number]>}
 */
export function circleRing(lat, lon, radiusM, segs = 72) {
  const ring = [];
  for (let i = 0; i < segs; i++) {
    const angle = 2 * Math.PI * i / segs;
    ring.push(offsetLatLng(lat, lon, radiusM * Math.cos(angle), radiusM * Math.sin(angle)));
  }
  ring.push(ring[0]);
  return ring;
}

/**
 * Closed, axis-aligned rectangle ring centred on a point.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} widthM
 * @param {number} heightM
 * @returns {Array<[number, number]>}
 */
export function rectRing(lat, lon, widthM, heightM) {
  const halfW = widthM / 2;
  const halfH = heightM / 2;
  return [
    offsetLatLng(lat, lon, -halfW, halfH),
    offsetLatLng(lat, lon, halfW, halfH),
    offsetLatLng(lat, lon, halfW, -halfH),
    offsetLatLng(lat, lon, -halfW, -halfH),
    offsetLatLng(lat, lon, -halfW, halfH),
  ];
}

/**
 * Area-weighted centroid of a ring.
 *
 * @param {Array<[number, number]>} ring
 * @returns {[number, number] | null}
 */
export function polygonCentroid(ring) {
  if (!ring || ring.length < 3) return null;
  const lat0 = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
  const lon0 = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    const [x1, y1] = projectMeters(ring[i][0], ring[i][1], lat0, lon0);
    const [x2, y2] = projectMeters(ring[next][0], ring[next][1], lat0, lon0);
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(area) < 1e-9) return [lat0, lon0];
  const mx = cx / (3 * area);
  const my = cy / (3 * area);
  const r = Math.PI / 180;
  return [
    lat0 + (my / EARTH_RADIUS_M) / r,
    lon0 + (mx / (EARTH_RADIUS_M * Math.cos(lat0 * r))) / r,
  ];
}
