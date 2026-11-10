/**
 * URL-based state encoding / decoding for rate-profile comparisons.
 *
 * Format (stored in the page hash, without the leading "#"):
 *   <profile-token>,<profile-token>,...
 *
 * Each profile token is a colon-separated list of 15 fields:
 *   [0]  name             (percent-encoded to survive URL round-trips)
 *   [1]  ratesType        (ACTUAL | BETAFLIGHT)
 *   [2]  roll.center      (integer 0-255)
 *   [3]  roll.maxRate     (integer; ACTUAL 200-2000 deg/s, BETAFLIGHT 0-100)
 *   [4]  roll.expo        (integer 0-100)
 *   [5]  pitch.center
 *   [6]  pitch.maxRate
 *   [7]  pitch.expo
 *   [8]  yaw.center
 *   [9]  yaw.maxRate
 *   [10] yaw.expo
 *   [11] throttle.mid     (integer 0-100)
 *   [12] throttle.expo    (integer 0-100)
 *   [13] throttle.limitType  (OFF | SCALE | CLIP; unknown values normalize to OFF)
 *   [14] throttle.limitPercent (integer 25-100)
 *
 * Numeric fields are clamped to the UI slider ranges so hand-edited links
 * degrade gracefully instead of producing broken curves.
 *
 * Example URL:
 *   rate-profile/#Profile%20A:ACTUAL:70:670:0:70:670:0:70:670:0:50:0:OFF:100,Profile%20B:ACTUAL:100:800:25:100:800:25:90:500:10:50:0:OFF:100
 */

const FIELD_SEP = ":";
const PROFILE_SEP = ",";
const EXPECTED_FIELDS = 15;

const RATES_TYPES = ["ACTUAL", "BETAFLIGHT"];
const LIMIT_TYPES = ["OFF", "SCALE", "CLIP"];

/** Clamp an integer to [min, max]. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Encode one profile object into a compact URL token.
 * @param {Object} profile
 * @returns {string}
 */
export function encodeProfile(profile) {
  const { name = "", ratesType = "ACTUAL", rates, throttle } = profile;
  return [
    encodeURIComponent(name),
    ratesType,
    rates.roll.center,
    rates.roll.maxRate,
    rates.roll.expo,
    rates.pitch.center,
    rates.pitch.maxRate,
    rates.pitch.expo,
    rates.yaw.center,
    rates.yaw.maxRate,
    rates.yaw.expo,
    throttle.mid,
    throttle.expo,
    throttle.limitType,
    throttle.limitPercent,
  ].join(FIELD_SEP);
}

/**
 * Decode a compact URL token into a profile object.
 * Returns null when the token is malformed, has non-integer numeric fields,
 * or names an unsupported rates type. Numeric fields are clamped to slider
 * ranges; unknown limit types normalize to OFF.
 * @param {string} token
 * @returns {Object|null}
 */
export function decodeProfile(token) {
  const parts = token.split(FIELD_SEP);
  if (parts.length !== EXPECTED_FIELDS) return null;
  const [rawName, rawRatesType, rc, rm, re, pc, pm, pe, yc, ym, ye, tm, te, lt, lp] = parts;

  const ratesType = rawRatesType.toUpperCase();
  if (!RATES_TYPES.includes(ratesType)) return null;

  const nums = [rc, rm, re, pc, pm, pe, yc, ym, ye, tm, te, lp].map((v) => parseInt(v, 10));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [rollC, rollM, rollE, pitchC, pitchM, pitchE, yawC, yawM, yawE, thrMid, thrExpo, thrLp] =
    nums;

  const maxRateRange = ratesType === "ACTUAL" ? [200, 2000] : [0, 100];
  const axis = (center, maxRate, expo) => ({
    center: clamp(center, 0, 255),
    maxRate: clamp(maxRate, ...maxRateRange),
    expo: clamp(expo, 0, 100),
  });

  const limitType = LIMIT_TYPES.includes(lt.toUpperCase()) ? lt.toUpperCase() : "OFF";

  return {
    name: decodeURIComponent(rawName),
    ratesType,
    rates: {
      roll: axis(rollC, rollM, rollE),
      pitch: axis(pitchC, pitchM, pitchE),
      yaw: axis(yawC, yawM, yawE),
    },
    throttle: {
      mid: clamp(thrMid, 0, 100),
      expo: clamp(thrExpo, 0, 100),
      limitType,
      limitPercent: clamp(thrLp, 25, 100),
    },
  };
}

/**
 * Encode an array of profile objects into a hash string (no leading "#").
 * @param {Object[]} profiles
 * @returns {string}
 */
export function encodeProfiles(profiles) {
  return profiles.map(encodeProfile).join(PROFILE_SEP);
}

/**
 * Decode a hash string into an array of profiles.
 * A leading "#" is tolerated; invalid tokens are silently skipped.
 * @param {string} hash
 * @returns {Object[]}
 */
export function decodeProfiles(hash) {
  const cleaned = (hash || "").replace(/^#/, "");
  if (!cleaned) return [];
  return cleaned.split(PROFILE_SEP).map(decodeProfile).filter(Boolean);
}

/**
 * Build a full shareable URL encoding all given profiles.
 * @param {Object[]} profiles
 * @param {string} [base] - Base URL without hash; defaults to the current page
 * @returns {string}
 */
export function buildShareUrl(profiles, base = location.href.split("#")[0]) {
  return `${base}#${encodeProfiles(profiles)}`;
}
