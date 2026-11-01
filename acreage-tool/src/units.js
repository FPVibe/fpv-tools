/**
 * Unit conversions and formatting for the acreage tool.
 *
 * Pure functions, no DOM. Lengths are metres internally; areas are square
 * metres. Everything a user types is converted on the way in and formatted
 * on the way out, so switching the display unit never changes the physical
 * size of a shape.
 */

/** Length unit -> metres. */
export const LEN_UNITS = {
  m: 1,
  km: 1000,
  ft: 0.3048,
  yd: 0.9144,
  mi: 1609.344,
};

/** Area unit -> square metres. */
export const AREA_UNITS = {
  ac: 4046.8564224,
  ha: 10000,
  m2: 1,
  ft2: 0.09290304,
  km2: 1e6,
  mi2: 2589988.110336,
};

/** Display names for the length units. */
export const LEN_UNIT_NAMES = {
  m: "m",
  km: "km",
  ft: "ft",
  yd: "yd",
  mi: "mi",
};

/** Display names for the area units. */
export const AREA_UNIT_NAMES = {
  ac: "acres",
  ha: "hectares",
  m2: "m²",
  ft2: "ft²",
  km2: "km²",
  mi2: "mi²",
};

/** Convert a length in `unit` to metres. */
export function toMeters(value, unit) {
  return value * (LEN_UNITS[unit] ?? 1);
}

/** Convert metres into `unit`. */
export function fromMeters(meters, unit) {
  return meters / (LEN_UNITS[unit] ?? 1);
}

/** Convert an area in `unit` to square metres. */
export function toSquareMeters(value, unit) {
  return value * (AREA_UNITS[unit] ?? 1);
}

/** Convert square metres into `unit`. */
export function fromSquareMeters(squareMeters, unit) {
  return squareMeters / (AREA_UNITS[unit] ?? 1);
}

/** Radius of a circle covering `squareMeters`. */
export function circleRadiusForArea(squareMeters) {
  return Math.sqrt(squareMeters / Math.PI);
}

/** Side length of a square covering `squareMeters`. */
export function squareSideForArea(squareMeters) {
  return Math.sqrt(squareMeters);
}

/** Format an area for display in `unit`. */
export function formatArea(squareMeters, unit) {
  const value = fromSquareMeters(squareMeters, unit);
  const name = AREA_UNIT_NAMES[unit] ?? unit;
  if (unit === "ac" || unit === "ha") return `${value.toFixed(2)} ${name}`;
  if (unit === "m2" || unit === "ft2") return `${Math.round(value).toLocaleString()} ${name}`;
  return `${value.toFixed(2)} ${name}`;
}

/** Format a length for display in `unit`. */
export function formatLength(meters, unit) {
  const value = fromMeters(meters, unit);
  const name = LEN_UNIT_NAMES[unit] ?? unit;
  if (unit === "ft") return `${Math.round(value).toLocaleString()} ${name}`;
  if (unit === "m" || unit === "yd") return `${value.toFixed(1)} ${name}`;
  return `${value.toFixed(2)} ${name}`;
}
