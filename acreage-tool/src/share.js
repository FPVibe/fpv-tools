/**
 * Deep-link encoding for the acreage tool.
 *
 * Pure functions, no DOM. A shape is encoded into the URL hash so it can be
 * sent to someone else and restored exactly:
 *
 *   #s=circle,42.91570,-89.22525,481.53&u=ac
 *   #s=polygon,42.91570,-89.22525,42.92000,-89.23000&u=ac
 *
 * The `s` parameter may repeat to carry several shapes. `u` carries the area
 * unit the sender was reading, so the recipient sees the same number rather
 * than the same measurement in different units.
 *
 * Decoding is strict: a malformed token rejects the whole payload rather
 * than half-applying it. Numbers are validated as whole tokens before
 * parsing, because parseFloat quietly swallows trailing junk ("1.2junk"
 * parses as 1.2).
 */

/** Shape types that can be encoded. */
export const SHAREABLE_TYPES = ["circle", "square", "rect", "polygon"];

/** Area units a link may carry. */
export const SHAREABLE_AREA_UNITS = ["ac", "ha", "m2", "ft2", "km2", "mi2"];

/** A numeric token: optional sign, digits, optional fraction. */
const NUM_TOKEN = /^-?\d+(\.\d+)?$/;

/** Strict whole-token numeral check. */
function isNumToken(token) {
  return NUM_TOKEN.test(token);
}

/** Format a number for the wire: fixed precision, trailing zeros trimmed. */
function num(value, decimals) {
  const fixed = Number(value).toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

function inRange(lat, lon) {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/**
 * Encode one shape into its wire form.
 *
 * @param {object} shape
 * @param {string} [areaUnit]
 * @returns {string} the hash payload (no leading `#`)
 */
export function encodeShape(shape, areaUnit) {
  const parts = [shape.type];
  if (shape.type === "polygon") {
    for (const point of shape.pts) {
      parts.push(num(point[0], 6), num(point[1], 6));
    }
  } else {
    parts.push(num(shape.lat, 6), num(shape.lon, 6));
    if (shape.type === "circle") parts.push(num(shape.r, 3));
    if (shape.type === "square") parts.push(num(shape.s, 3));
    if (shape.type === "rect") parts.push(num(shape.w, 3), num(shape.h, 3));
  }
  const params = new URLSearchParams();
  // Commas stay literal: they are legal in a fragment and keep the link
  // readable. The decoder accepts either form.
  params.set("s", parts.join(","));
  if (areaUnit && SHAREABLE_AREA_UNITS.includes(areaUnit)) params.set("u", areaUnit);
  return params.toString().replace(/%2C/g, ",");
}

/**
 * Encode one or more shapes plus the area unit into a hash payload.
 *
 * @param {object[]} shapes
 * @param {string} [areaUnit]
 * @returns {string}
 */
export function encodeShapes(shapes, areaUnit) {
  const params = new URLSearchParams();
  for (const shape of shapes) {
    params.append("s", encodeShape(shape, null).replace(/^s=/, ""));
  }
  if (areaUnit && SHAREABLE_AREA_UNITS.includes(areaUnit)) params.set("u", areaUnit);
  return params.toString().replace(/%2C/g, ",");
}

/**
 * Build a full share URL for a shape.
 *
 * @param {string} baseUrl the page URL without a hash
 * @param {object[]} shapes
 * @param {string} [areaUnit]
 * @returns {string}
 */
export function shareUrl(baseUrl, shapes, areaUnit) {
  const base = baseUrl.split("#")[0];
  return `${base}#${encodeShapes(shapes, areaUnit)}`;
}

/**
 * Decode a hash payload into shapes.
 *
 * @param {string} hash the location hash, with or without a leading `#`
 * @returns {{shapes: object[], areaUnit: string | null} | null} null when the
 *   payload is absent or malformed
 */
export function decodeShapes(hash) {
  const raw = (hash || "").replace(/^#/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const entries = params.getAll("s");
  if (!entries.length) return null;

  const shapes = [];
  for (const entry of entries) {
    const shape = decodeShapeEntry(entry);
    // Reject the whole payload if any shape is malformed.
    if (!shape) return null;
    shapes.push(shape);
  }

  const unit = params.get("u");
  return { shapes, areaUnit: unit && SHAREABLE_AREA_UNITS.includes(unit) ? unit : null };
}

/**
 * Decode a single shape entry.
 *
 * @param {string} entry
 * @returns {object | null}
 */
export function decodeShapeEntry(entry) {
  const parts = String(entry).split(",");
  const type = parts[0];
  if (!SHAREABLE_TYPES.includes(type)) return null;

  const tokens = parts.slice(1);
  if (!tokens.every(isNumToken)) return null;
  const values = tokens.map(Number);
  if (!values.every((v) => Number.isFinite(v))) return null;

  if (type === "circle") {
    if (values.length !== 3) return null;
    const [lat, lon, r] = values;
    if (!inRange(lat, lon) || r <= 0) return null;
    return { type, lat, lon, r };
  }
  if (type === "square") {
    if (values.length !== 3) return null;
    const [lat, lon, s] = values;
    if (!inRange(lat, lon) || s <= 0) return null;
    return { type, lat, lon, s };
  }
  if (type === "rect") {
    if (values.length !== 4) return null;
    const [lat, lon, w, h] = values;
    if (!inRange(lat, lon) || w <= 0 || h <= 0) return null;
    return { type, lat, lon, w, h };
  }
  // polygon
  if (values.length < 6 || values.length % 2 !== 0) return null;
  const pts = [];
  for (let i = 0; i < values.length; i += 2) {
    if (!inRange(values[i], values[i + 1])) return null;
    pts.push([values[i], values[i + 1]]);
  }
  return { type, pts };
}
