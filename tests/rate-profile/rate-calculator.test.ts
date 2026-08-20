import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  calculateBetaflightRate,
  calculateRate,
  calculateThrottle,
  normalizeLimitPercent,
  normalizeLimitType,
} from "../../rate-profile/src/rate-calculator.js";

Deno.test("calculateThrottle - limit type OFF leaves output unchanged", () => {
  const base = calculateThrottle(1.0, 50, 0);
  assertAlmostEquals(calculateThrottle(1.0, 50, 0, "OFF", 60), base, 1e-9);
});

Deno.test("calculateThrottle - SCALE multiplies output by percent", () => {
  const base = calculateThrottle(1.0, 50, 0);
  assertAlmostEquals(
    calculateThrottle(1.0, 50, 0, "SCALE", 80),
    base * 0.8,
    1e-9,
  );
});

Deno.test("calculateThrottle - SCALE at mid stick scales proportionally", () => {
  const base = calculateThrottle(0.5, 50, 0);
  assertAlmostEquals(
    calculateThrottle(0.5, 50, 0, "SCALE", 50),
    base * 0.5,
    1e-9,
  );
});

Deno.test("calculateThrottle - CLIP caps output at percent ceiling", () => {
  assertAlmostEquals(
    calculateThrottle(1.0, 50, 0, "CLIP", 70),
    0.7,
    1e-9,
  );
});

Deno.test("calculateThrottle - CLIP leaves values below ceiling untouched", () => {
  // base at input 0.2 is well below 0.7 ceiling
  const base = calculateThrottle(0.2, 50, 0);
  assertAlmostEquals(
    calculateThrottle(0.2, 50, 0, "CLIP", 70),
    base,
    1e-9,
  );
});

Deno.test("calculateThrottle - 100% limit equals OFF for both modes", () => {
  const base = calculateThrottle(1.0, 50, 0);
  assertEquals(calculateThrottle(1.0, 50, 0, "SCALE", 100), base);
  assertEquals(calculateThrottle(1.0, 50, 0, "CLIP", 100), base);
});

Deno.test("calculateThrottle - unknown limit type behaves as OFF", () => {
  const base = calculateThrottle(0.8, 50, 0);
  assertAlmostEquals(
    calculateThrottle(0.8, 50, 0, "BOGUS", 50),
    base,
    1e-9,
  );
});

Deno.test("calculateThrottle - lowercase limit type is normalized", () => {
  const base = calculateThrottle(1.0, 50, 0);
  assertAlmostEquals(
    calculateThrottle(1.0, 50, 0, "scale", 50),
    base * 0.5,
    1e-9,
  );
});

Deno.test("calculateThrottle - NaN limit percent does not poison output", () => {
  const base = calculateThrottle(1.0, 50, 0);
  assertAlmostEquals(
    calculateThrottle(1.0, 50, 0, "SCALE", NaN),
    base,
    1e-9,
  );
  assertAlmostEquals(
    calculateThrottle(1.0, 50, 0, "CLIP", NaN),
    base,
    1e-9,
  );
});

Deno.test("calculateThrottle - undefined limit type treated as OFF", () => {
  const base = calculateThrottle(0.8, 50, 0);
  assertAlmostEquals(
    calculateThrottle(0.8, 50, 0, undefined, 50),
    base,
    1e-9,
  );
});

Deno.test("normalizeLimitType - accepts canonical strings", () => {
  assertEquals(normalizeLimitType("OFF"), "OFF");
  assertEquals(normalizeLimitType("SCALE"), "SCALE");
  assertEquals(normalizeLimitType("CLIP"), "CLIP");
});

Deno.test("normalizeLimitType - case-insensitive and trims whitespace", () => {
  assertEquals(normalizeLimitType("scale"), "SCALE");
  assertEquals(normalizeLimitType("  clip  "), "CLIP");
});

Deno.test("normalizeLimitType - falls back to OFF for unknown/missing", () => {
  assertEquals(normalizeLimitType("bogus"), "OFF");
  assertEquals(normalizeLimitType(undefined), "OFF");
  assertEquals(normalizeLimitType(null), "OFF");
  assertEquals(normalizeLimitType(""), "OFF");
});

Deno.test("normalizeLimitPercent - keeps valid numbers in range", () => {
  assertEquals(normalizeLimitPercent(25), 25);
  assertEquals(normalizeLimitPercent(80), 80);
  assertEquals(normalizeLimitPercent(100), 100);
});

Deno.test("normalizeLimitPercent - clamps out-of-range to Betaflight 25..100", () => {
  assertEquals(normalizeLimitPercent(-5), 25);
  assertEquals(normalizeLimitPercent(0), 25);
  assertEquals(normalizeLimitPercent(10), 25);
  assertEquals(normalizeLimitPercent(150), 100);
});

Deno.test("normalizeLimitPercent - non-finite values default to 100", () => {
  assertEquals(normalizeLimitPercent(NaN), 100);
  assertEquals(normalizeLimitPercent(Infinity), 100);
  assertEquals(normalizeLimitPercent(undefined), 100);
  assertEquals(normalizeLimitPercent("abc"), 100);
});

Deno.test("normalizeLimitPercent - coerces numeric strings", () => {
  assertEquals(normalizeLimitPercent("70"), 70);
});

// ---------------------------------------------------------------------------
// calculateBetaflightRate
// ---------------------------------------------------------------------------

Deno.test("calculateBetaflightRate - zero input returns zero regardless of super-rate", () => {
  assertAlmostEquals(calculateBetaflightRate(0, 100, 50, 0), 0, 1e-9);
});

Deno.test("calculateBetaflightRate - full stick, no super-rate, no expo: 200 * rcRate/100", () => {
  // rate = 100/100 = 1.0; angularVel = 200 * 1.0 * 1 = 200
  assertAlmostEquals(calculateBetaflightRate(1, 100, 0, 0), 200, 1e-9);
});

Deno.test("calculateBetaflightRate - full stick with 50% super-rate doubles output", () => {
  // angularVel = 200; rcFactor = 1/(1 - 1.0*0.5) = 2; result = 400
  assertAlmostEquals(calculateBetaflightRate(1, 100, 50, 0), 400, 1e-9);
});

Deno.test("calculateBetaflightRate - negative input is symmetric", () => {
  const pos = calculateBetaflightRate(1, 100, 50, 0);
  assertAlmostEquals(calculateBetaflightRate(-1, 100, 50, 0), -pos, 1e-9);
});

Deno.test("calculateBetaflightRate - RC_RATE_INCREMENTAL applied above rc_rate 200", () => {
  // rate = 210/100 = 2.1; incremental += 14.54*(2.1-2.0)=1.454; rate=3.554
  // angularVel = 200 * 3.554 * 1 = 710.8
  assertAlmostEquals(calculateBetaflightRate(1, 210, 0, 0), 710.8, 1e-6);
});

Deno.test("calculateBetaflightRate - super-rate uses post-expo absolute value", () => {
  // At half-stick with expo=50: rcCommandf = 0.5*(0.5*0.5^3 + 0.5) = 0.5*0.5625 = 0.28125
  // angularVel = 200 * 1.0 * 0.28125 = 56.25
  // rcFactor (post-expo) = 1/(1 - 0.28125*0.5) = 1/0.859375 ≈ 1.16364
  // result ≈ 65.455
  const result = calculateBetaflightRate(0.5, 100, 50, 50);
  assertAlmostEquals(result, 56.25 / 0.859375, 1e-6);
});

// ---------------------------------------------------------------------------
// calculateRate (dispatcher)
// ---------------------------------------------------------------------------

Deno.test("calculateRate - defaults to ACTUAL algorithm", () => {
  // At full stick, center=70, maxRate=670, expo=0:
  // cs = 70/10 = 7; stickMovement = 670-7 = 663
  // rate = 1 * (7 + 663 * 1) = 670
  assertAlmostEquals(calculateRate(1, 70, 670, 0), 670, 1e-9);
});

Deno.test("calculateRate - ACTUAL ratesType uses ACTUAL algorithm", () => {
  assertAlmostEquals(calculateRate(1, 70, 670, 0, "ACTUAL"), 670, 1e-9);
});

Deno.test("calculateRate - BETAFLIGHT ratesType uses BETAFLIGHT algorithm", () => {
  // Same as calculateBetaflightRate(1, 100, 50, 0) = 400
  assertAlmostEquals(calculateRate(1, 100, 50, 0, "BETAFLIGHT"), 400, 1e-9);
});

Deno.test("calculateRate - ratesType comparison is case-insensitive", () => {
  const lower = calculateRate(1, 100, 50, 0, "betaflight");
  const upper = calculateRate(1, 100, 50, 0, "BETAFLIGHT");
  assertAlmostEquals(lower, upper, 1e-9);
});

Deno.test("calculateRate - unknown ratesType falls back to ACTUAL", () => {
  const actual = calculateRate(1, 70, 670, 0, "ACTUAL");
  assertAlmostEquals(calculateRate(1, 70, 670, 0, "UNKNOWN"), actual, 1e-9);
});

// ---------------------------------------------------------------------------
// calculateActualRate — formula correctness tests (regression for #37)
// ---------------------------------------------------------------------------

Deno.test("calculateActualRate - zero stick always returns zero", () => {
  // Regardless of params, no stick input → no rate
  assertAlmostEquals(calculateRate(0, 70, 670, 0), 0, 1e-9);
  assertAlmostEquals(calculateRate(0, 70, 670, 50), 0, 1e-9);
});

Deno.test("calculateActualRate - center sensitivity is roll_rc_rate divided by 10", () => {
  // At vanishingly small stick, rate ≈ rcCommand * cs = rcCommand * (center/10)
  // Use a small but non-negligible stick value (1% stick, expo=0)
  // rate = 0.01 * (cs + stickMovement * 0.01) ≈ 0.01 * cs  (stickMovement term is tiny)
  // cs = 100/10 = 10 → rate ≈ 0.01 * 10 = 0.1  (old code: cs=1000 → 10 — 100× off)
  const rate = calculateRate(0.01, 100, 670, 0);
  // stickMovement = 670 - 10 = 660; rate = 0.01*(10 + 660*0.01) = 0.01*16.6 = 0.166
  assertAlmostEquals(rate, 0.01 * (10 + 660 * 0.01), 1e-9);
});

Deno.test("calculateActualRate - expo softens center without changing full-stick output", () => {
  // At full stick (rcCommand=1), expo has no effect on the output
  const withExpo = calculateRate(1, 70, 670, 50);
  const noExpo = calculateRate(1, 70, 670, 0);
  assertAlmostEquals(withExpo, noExpo, 1e-9);
});

Deno.test("calculateActualRate - expo reduces rate at mid-stick", () => {
  // At half-stick, expo=50 should give a lower rate than expo=0
  const withExpo = calculateRate(0.5, 70, 670, 50);
  const noExpo = calculateRate(0.5, 70, 670, 0);
  // expo=50 softens center, so mid-stick rate should be lower
  if (withExpo >= noExpo) {
    throw new Error(`Expected expo to reduce mid-stick rate: ${withExpo} >= ${noExpo}`);
  }
});

Deno.test("calculateActualRate - negative input produces equal-magnitude negative output", () => {
  const pos = calculateRate(0.5, 70, 670, 30);
  const neg = calculateRate(-0.5, 70, 670, 30);
  assertAlmostEquals(neg, -pos, 1e-9);
});

Deno.test("calculateActualRate - mid-stick with expo=50 matches firmware formula", () => {
  // rcCommand=0.5, center=70, maxRate=670, expo=50
  // expoNorm=0.5; rcCommandf = 0.5*(0.5*0.25 + 0.5) = 0.5*0.625 = 0.3125
  // cs = 70/10 = 7; stickMovement = 670-7 = 663
  // rate = 0.3125 * (7 + 663*0.5) = 0.3125 * (7 + 331.5) = 0.3125 * 338.5 = 105.78125
  const expected = 0.3125 * (7 + 663 * 0.5);
  assertAlmostEquals(calculateRate(0.5, 70, 670, 50), expected, 1e-9);
});

Deno.test("calculateActualRate - full-stick output equals maxRate (regression: import roll_srate×10)", () => {
  // The graph endpoint is always exactly maxRate, regardless of center or expo.
  // After fixing import to apply ×10 (roll_srate=110 → maxRate=1100), the graph
  // must show 1100 deg/s at full stick — not 110.
  assertAlmostEquals(calculateRate(1, 70, 1100, 0), 1100, 1e-9);
  assertAlmostEquals(calculateRate(1, 16, 1100, 30), 1100, 1e-9); // expo doesn't change endpoint
  assertAlmostEquals(calculateRate(1, 70, 670, 0), 670, 1e-9); // existing profile still correct
});
