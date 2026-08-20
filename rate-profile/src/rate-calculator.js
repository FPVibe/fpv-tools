// Increment applied to rc_rate when it exceeds 2.0 in BETAFLIGHT mode.
// Matches the RC_RATE_INCREMENTAL constant in the Betaflight source.
const RC_RATE_INCREMENTAL = 14.54;

/**
 * Calculate the actual rate based on Betaflight's Actual Rates algorithm
 * @param {number} rcCommand - RC stick input from -1 to 1
 * @param {number} center - Center sensitivity (0-255)
 * @param {number} maxRate - Maximum rate in deg/s (200-2000)
 * @param {number} expo - Expo value (0-100)
 * @returns {number} Rate in degrees per second
 */
export function calculateActualRate(rcCommand, center, maxRate, expo) {
  const rcCommandAbs = Math.abs(rcCommand);

  // Apply expo curve
  let expof;
  if (expo > 0) {
    const expoPower = 3;
    expof = (expo / 100.0) * Math.pow(rcCommandAbs, expoPower) + rcCommandAbs * (1 - expo / 100.0);
  } else {
    expof = rcCommandAbs;
  }

  // Calculate center sensitivity (controls the slope at center stick)
  const centerSensitivity = center * 10; // center is 0-255, multiply by 10 for deg/s

  // Calculate the rate
  const rate = rcCommandAbs * centerSensitivity + expof * (maxRate - centerSensitivity);

  return rcCommand >= 0 ? rate : -rate;
}

/**
 * Calculate the rate using Betaflight's classic (BETAFLIGHT) algorithm.
 *
 * Parameter semantics differ from ACTUAL rates:
 *   - rcRate  → roll_rc_rate (0-255): overall rate multiplier
 *   - superRate → roll_rate (0-100): "super-rate" applied above 65% stick
 *   - expo    → roll_expo  (0-100): expo curve
 *
 * @param {number} rcCommand - RC stick input from -1 to 1
 * @param {number} rcRate    - rc_rate CLI value (0-255)
 * @param {number} superRate - super-rate CLI value (0-100)
 * @param {number} expo      - expo CLI value (0-100)
 * @returns {number} Rate in degrees per second
 */
export function calculateBetaflightRate(rcCommand, rcRate, superRate, expo) {
  const rcCommandAbs = Math.abs(rcCommand);

  // Apply expo
  let rcCommandf = rcCommand;
  if (expo > 0) {
    const expof = expo / 100;
    rcCommandf = rcCommand * (expof * Math.pow(rcCommandAbs, 3) + (1 - expof));
  }

  // Base rate (CLI value 0-255 → 0-2.55; incremental above 2.0)
  let rate = rcRate / 100;
  if (rate > 2.0) {
    rate += RC_RATE_INCREMENTAL * (rate - 2.0);
  }

  let angularVel = 200 * rate * rcCommandf;

  // Super-rate factor: boosts rate at high stick deflection.
  // Uses the post-expo absolute value (matching Betaflight firmware behaviour).
  if (superRate > 0) {
    const rcFactor = 1 / Math.max(0.01, 1 - Math.abs(rcCommandf) * (superRate / 100));
    angularVel *= rcFactor;
  }

  return angularVel;
}

/**
 * Unified rate dispatcher — calls the right algorithm for the given ratesType.
 * @param {number} rcCommand - RC stick input from -1 to 1
 * @param {number} center    - roll_rc_rate CLI value
 * @param {number} maxRate   - roll_srate (ACTUAL) or roll_rate super-rate (BETAFLIGHT)
 * @param {number} expo      - roll_expo CLI value
 * @param {string} ratesType - 'ACTUAL' (default) or 'BETAFLIGHT'
 * @returns {number} Rate in degrees per second
 */
export function calculateRate(rcCommand, center, maxRate, expo, ratesType = "ACTUAL") {
  const type = (ratesType || "ACTUAL").toUpperCase();
  if (type === "BETAFLIGHT") {
    return calculateBetaflightRate(rcCommand, center, maxRate, expo);
  }
  return calculateActualRate(rcCommand, center, maxRate, expo);
}

/**
 * Normalize a throttle limit type to one of OFF/SCALE/CLIP.
 * Anything unrecognized (including null/undefined) becomes OFF.
 * @param {unknown} value
 * @returns {'OFF'|'SCALE'|'CLIP'}
 */
export function normalizeLimitType(value) {
  const t = String(value ?? "").trim().toUpperCase();
  return t === "SCALE" || t === "CLIP" ? t : "OFF";
}

/**
 * Normalize a throttle limit percent. Non-finite values fall back to 100;
 * valid numbers are clamped to Betaflight's 25..100 range to match both the
 * UI slider bounds and the firmware's documented limits.
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeLimitPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(25, n));
}

/**
 * Calculate throttle output with mid point and expo
 * @param {number} input - Throttle stick input from 0 to 1
 * @param {number} midPoint - Mid point value (0-100)
 * @param {number} expo - Expo value (0-100)
 * @param {string} [limitType='OFF'] - Throttle limit mode: 'OFF', 'SCALE', or 'CLIP'
 * @param {number} [limitPercent=100] - Throttle limit percentage (25-100)
 * @returns {number} Throttle output from 0 to 1
 */
export function calculateThrottle(input, midPoint, expo, limitType = "OFF", limitPercent = 100) {
  const mid = midPoint / 100;
  const expoNorm = expo / 100;

  // Apply expo to the entire stick range
  const expof = input * (1 - expoNorm) + Math.pow(input, 3) * expoNorm;

  // Scale the expo curve to pass through the mid point at 50% stick
  let throttle;
  if (expof < 0.5) {
    // Scale 0-0.5 input to 0-mid output
    throttle = expof * 2 * mid;
  } else {
    // Scale 0.5-1.0 input to mid-1.0 output
    throttle = mid + (expof - 0.5) * 2 * (1 - mid);
  }

  const type = normalizeLimitType(limitType);
  const limit = normalizeLimitPercent(limitPercent) / 100;
  if (type === "SCALE") {
    throttle = throttle * limit;
  } else if (type === "CLIP") {
    throttle = Math.min(throttle, limit);
  }

  return throttle;
}
