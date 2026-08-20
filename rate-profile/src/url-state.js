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
 *   [3]  roll.maxRate     (integer, deg/s)
 *   [4]  roll.expo        (integer 0-100)
 *   [5]  pitch.center
 *   [6]  pitch.maxRate
 *   [7]  pitch.expo
 *   [8]  yaw.center
 *   [9]  yaw.maxRate
 *   [10] yaw.expo
 *   [11] throttle.mid     (integer 0-100)
 *   [12] throttle.expo    (integer 0-100)
 *   [13] throttle.limitType  (OFF | SCALE | CLIP)
 *   [14] throttle.limitPercent (integer 25-100)
 *
 * Example URL:
 *   rate-profile/#Profile%20A:ACTUAL:70:670:0:70:670:0:70:670:0:50:0:OFF:100,Profile%20B:ACTUAL:100:800:25:100:800:25:90:500:10:50:0:OFF:100
 */

const FIELD_SEP = ":";
const PROFILE_SEP = ",";
const EXPECTED_FIELDS = 15;

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
 * Returns null when the token is malformed or contains invalid numbers.
 * @param {string} token
 * @returns {Object|null}
 */
export function decodeProfile(token) {
  const parts = token.split(FIELD_SEP);
  if (parts.length !== EXPECTED_FIELDS) return null;
  try {
    const [rawName, ratesType, rc, rm, re, pc, pm, pe, yc, ym, ye, tm, te, lt, lp] = parts;
    const ints = [rc, rm, re, pc, pm, pe, yc, ym, ye, tm, te, lp].map((v) => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n)) throw new RangeError(`not an integer: ${v}`);
      return n;
    });
    const [rollC, rollM, rollE, pitchC, pitchM, pitchE, yawC, yawM, yawE, thrMid, thrExpo, thrLp] =
      ints;
    return {
      name: decodeURIComponent(rawName),
      ratesType: ratesType.toUpperCase(),
      rates: {
        roll: { center: rollC, maxRate: rollM, expo: rollE },
        pitch: { center: pitchC, maxRate: pitchM, expo: pitchE },
        yaw: { center: yawC, maxRate: yawM, expo: yawE },
      },
      throttle: {
        mid: thrMid,
        expo: thrExpo,
        limitType: lt.toUpperCase(),
        limitPercent: thrLp,
      },
    };
  } catch {
    return null;
  }
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
 * Decode a hash string (without leading "#") into an array of profiles.
 * Invalid tokens are silently skipped.
 * @param {string} hash
 * @returns {Object[]}
 */
export function decodeProfiles(hash) {
  if (!hash) return [];
  return hash.split(PROFILE_SEP).map(decodeProfile).filter(Boolean);
}

/**
 * Build a full shareable URL encoding all given profiles.
 * @param {Object[]} profiles
 * @returns {string}
 */
export function buildShareUrl(profiles) {
  const base = location.href.split("#")[0];
  return `${base}#${encodeProfiles(profiles)}`;
}

/**
 * Build a full shareable URL encoding a single profile.
 * @param {Object} profile
 * @returns {string}
 */
export function buildSingleProfileShareUrl(profile) {
  return buildShareUrl([profile]);
}
