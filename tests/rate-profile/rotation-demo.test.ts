import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildFlickTimeline,
  simulateRotation,
  stickAt,
} from "../../rate-profile/src/rotation-demo.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Per-axis rate knobs as stored in the app's profile objects. */
interface AxisKnobs {
  center: number;
  maxRate: number;
  expo: number;
}

/** Profile shape used by the rate-profile app (see app.js createProfile). */
interface RatesProfile {
  ratesType: string;
  rates: { roll: AxisKnobs; pitch: AxisKnobs; yaw: AxisKnobs };
  throttle: { mid: number; expo: number };
}

/** Race-style ACTUAL knobs: full stick → 533 deg/s, half stick → 137 deg/s. */
const RACE_ROLL: AxisKnobs = { center: 150, maxRate: 533, expo: 0 };

/** Build a profile shaped like the app's profiles. */
function makeProfile(
  roll: AxisKnobs,
  ratesType = "ACTUAL",
  yaw: AxisKnobs = { center: 70, maxRate: 670, expo: 0 },
): RatesProfile {
  return {
    ratesType,
    rates: {
      roll,
      pitch: { center: 70, maxRate: 670, expo: 0 },
      yaw,
    },
    throttle: { mid: 50, expo: 0 },
  };
}

// ---------------------------------------------------------------------------
// stickAt
// ---------------------------------------------------------------------------

Deno.test("stickAt - interpolates linearly between timeline points", () => {
  const timeline = [{ t: 0, stick: -1 }, { t: 2, stick: 1 }];
  assertAlmostEquals(stickAt(timeline, 0.5), -0.5, 1e-12);
  assertAlmostEquals(stickAt(timeline, 1), 0, 1e-12);
  assertAlmostEquals(stickAt(timeline, 1.5), 0.5, 1e-12);
});

Deno.test("stickAt - clamps to the first stick value before the timeline starts", () => {
  const timeline = [{ t: 1, stick: 0.5 }, { t: 2, stick: 1 }];
  assertEquals(stickAt(timeline, 0), 0.5);
  assertEquals(stickAt(timeline, -5), 0.5);
});

Deno.test("stickAt - clamps to the last stick value after the timeline ends", () => {
  const timeline = [{ t: 0, stick: 0.2 }, { t: 1, stick: 0.8 }];
  assertEquals(stickAt(timeline, 1), 0.8);
  assertEquals(stickAt(timeline, 5), 0.8);
});

Deno.test("stickAt - empty timeline returns 0", () => {
  assertEquals(stickAt([], 3), 0);
});

Deno.test("stickAt - tracks a flick timeline through rise, hold, and fall", () => {
  const flick = buildFlickTimeline(); // rise 0.05s, hold 0.3s, fall 0.05s
  assertAlmostEquals(stickAt(flick, 0.025), 0.5, 1e-12); // halfway up the rise
  assertEquals(stickAt(flick, 0.2), 1); // mid-hold
  assertAlmostEquals(stickAt(flick, 0.375), 0.5, 1e-12); // halfway down the fall
  assertEquals(stickAt(flick, 10), 0); // clamped past the end
});

// ---------------------------------------------------------------------------
// buildFlickTimeline
// ---------------------------------------------------------------------------

Deno.test("buildFlickTimeline - defaults to peak 1, rise 0.05, hold 0.3, fall 0.05", () => {
  const flick = buildFlickTimeline();
  assertEquals(flick.length, 4);
  assertEquals(flick[0], { t: 0, stick: 0 });
  assertAlmostEquals(flick[1].t, 0.05, 1e-12);
  assertEquals(flick[1].stick, 1);
  assertAlmostEquals(flick[2].t, 0.35, 1e-12);
  assertEquals(flick[2].stick, 1);
  assertAlmostEquals(flick[3].t, 0.4, 1e-12);
  assertEquals(flick[3].stick, 0);
});

Deno.test("buildFlickTimeline - honors custom peak, rise, hold, and fall", () => {
  const flick = buildFlickTimeline({ peak: 0.5, rise: 0.1, hold: 0.2, fall: 0.1 });
  assertEquals(flick[0], { t: 0, stick: 0 });
  assertEquals(flick[1], { t: 0.1, stick: 0.5 });
  assertAlmostEquals(flick[2].t, 0.3, 1e-12);
  assertEquals(flick[2].stick, 0.5);
  assertAlmostEquals(flick[3].t, 0.4, 1e-12);
  assertEquals(flick[3].stick, 0);
});

// ---------------------------------------------------------------------------
// simulateRotation — rate dispatch and integration
// ---------------------------------------------------------------------------

Deno.test("simulateRotation - full stick for 0.5s integrates to 266.5 degrees", () => {
  // ACTUAL center=150, maxRate=533, expo=0: cs = 15, stickMove = 518, so the
  // rate at full stick is exactly 1 * (15 + 518 * 1) = 533 deg/s. A timeline
  // ending at t=0 gets the default 0.5s duration → 60 steps of 1/120s.
  const result = simulateRotation(makeProfile(RACE_ROLL), "roll", [{ t: 0, stick: 1 }]);
  assertEquals(result.series[0], { t: 0, stick: 1, rate: 533, angle: 0 });
  assertEquals(result.series.length, 61); // round(0.5 / (1/120)) + 1
  assertAlmostEquals(result.angle, 266.5, 1e-9); // 533 deg/s * 0.5s
  const last = result.series[result.series.length - 1];
  assertAlmostEquals(last.t, 0.5, 1e-9);
  assertAlmostEquals(last.angle, 266.5, 1e-9);
});

Deno.test("simulateRotation - half stick produces 137 deg/s (0.5 * (15 + 518*0.5))", () => {
  const result = simulateRotation(makeProfile(RACE_ROLL), "roll", [{ t: 0, stick: 0.5 }]);
  assertAlmostEquals(result.series[0].rate, 137, 1e-9);
});

Deno.test("simulateRotation - expo 30 yields a strictly lower mid-stick rate than expo 0", () => {
  const noExpo = simulateRotation(makeProfile(RACE_ROLL), "roll", [{ t: 0, stick: 0.5 }]);
  const withExpo = simulateRotation(
    makeProfile({ center: 150, maxRate: 533, expo: 30 }),
    "roll",
    [{ t: 0, stick: 0.5 }],
  );
  if (withExpo.series[0].rate >= noExpo.series[0].rate) {
    throw new Error(
      `Expected expo to lower mid-stick rate: ${withExpo.series[0].rate} >= ${
        noExpo.series[0].rate
      }`,
    );
  }
  // rcCommandf = 0.5 * (0.3 * 0.25 + 0.7) = 0.3875 → 0.3875 * 274 = 106.175
  assertAlmostEquals(withExpo.series[0].rate, 106.175, 1e-9);
});

Deno.test("simulateRotation - sbang turns ~2.44x the race profile on the same 1s flick", () => {
  const flick = buildFlickTimeline({ hold: 1 }); // 1s of full stick
  const race = simulateRotation(makeProfile(RACE_ROLL), "roll", flick);
  const sbang = simulateRotation(
    makeProfile({ center: 300, maxRate: 1300, expo: 0 }),
    "roll",
    flick,
  );
  // Full-stick rates: race 533 deg/s vs sbang 1300 deg/s → 1300/533 ≈ 2.44
  assertAlmostEquals(sbang.angle / race.angle, 2.44, 0.01);
});

Deno.test("simulateRotation - axis yaw uses the yaw rates, not roll", () => {
  const profile = makeProfile(RACE_ROLL, "ACTUAL", { center: 70, maxRate: 670, expo: 0 });
  const yaw = simulateRotation(profile, "yaw", [{ t: 0, stick: 1 }]);
  const roll = simulateRotation(profile, "roll", [{ t: 0, stick: 1 }]);
  assertEquals(yaw.series[0].rate, 670); // 1 * (7 + 663 * 1)
  assertAlmostEquals(yaw.angle, 335, 1e-9); // 670 deg/s * 0.5s
  assertEquals(roll.series[0].rate, 533);
});

Deno.test("simulateRotation - BETAFLIGHT ratesType dispatches to the Betaflight algorithm", () => {
  const timeline = [{ t: 0, stick: 1 }];
  const knobs = { center: 100, maxRate: 50, expo: 0 };
  const actual = simulateRotation(makeProfile(knobs, "ACTUAL"), "roll", timeline);
  const betaflight = simulateRotation(makeProfile(knobs, "BETAFLIGHT"), "roll", timeline);
  // Same knobs, different algorithms. ACTUAL: cs=10, stickMove=40 → 50 deg/s.
  // BETAFLIGHT: 200 * (100/100) * 1 = 200, super-rate factor 1/(1-0.5) = 2 → 400.
  assertAlmostEquals(actual.series[0].rate, 50, 1e-9);
  assertAlmostEquals(betaflight.series[0].rate, 400, 1e-9);
  if (betaflight.series[0].rate === actual.series[0].rate) {
    throw new Error("Expected BETAFLIGHT dispatch to differ from ACTUAL for the same knobs");
  }
});

// ---------------------------------------------------------------------------
// simulateRotation — timing defaults
// ---------------------------------------------------------------------------

Deno.test("simulateRotation - default dt is 1/120", () => {
  const result = simulateRotation(makeProfile(RACE_ROLL), "roll", buildFlickTimeline());
  assertEquals(result.series[1].t, 1 / 120);
});

Deno.test("simulateRotation - default duration is last timeline t plus 0.5", () => {
  const flick = simulateRotation(makeProfile(RACE_ROLL), "roll", buildFlickTimeline());
  // Flick ends at t=0.4 → duration 0.9 → round(0.9 * 120) + 1 = 109 entries
  assertEquals(flick.series.length, 109);
  assertAlmostEquals(flick.series[flick.series.length - 1].t, 0.9, 1e-9);

  const held = simulateRotation(makeProfile(RACE_ROLL), "roll", [{ t: 1, stick: 0 }]);
  assertEquals(held.series.length, 181); // duration 1.5 → 180 steps + t=0
  assertAlmostEquals(held.series[held.series.length - 1].t, 1.5, 1e-9);
});

Deno.test("simulateRotation - explicit dt and duration override the defaults", () => {
  const result = simulateRotation(makeProfile(RACE_ROLL), "roll", [{ t: 0, stick: 1 }], {
    dt: 0.01,
    duration: 0.5,
  });
  assertEquals(result.series.length, 51); // round(0.5 / 0.01) + 1
  assertAlmostEquals(result.angle, 266.5, 1e-9); // 533 deg/s * 0.5s
});

// ---------------------------------------------------------------------------
// simulateRotation — edge cases
// ---------------------------------------------------------------------------

Deno.test("simulateRotation - negative stick produces a negative angle", () => {
  const held = simulateRotation(makeProfile(RACE_ROLL), "roll", [{ t: 0, stick: -1 }]);
  assertEquals(held.series[0].rate, -533);
  assertAlmostEquals(held.angle, -266.5, 1e-9);
  if (held.angle >= 0) throw new Error(`Expected negative angle, got ${held.angle}`);

  // A negative flick mirrors the positive flick exactly (sign preserved).
  const positive = simulateRotation(makeProfile(RACE_ROLL), "roll", buildFlickTimeline());
  const negative = simulateRotation(
    makeProfile(RACE_ROLL),
    "roll",
    buildFlickTimeline({ peak: -1 }),
  );
  assertEquals(negative.angle, -positive.angle);
});

Deno.test("simulateRotation - empty timeline simulates to zero angle without throwing", () => {
  const result = simulateRotation(makeProfile(RACE_ROLL), "roll", []);
  assertEquals(result.angle, 0);
  assertEquals(result.series.length, 61); // duration defaults to 0 + 0.5
  for (const point of result.series) {
    assertEquals(point.stick, 0);
    assertEquals(point.rate, 0);
    assertEquals(point.angle, 0);
  }
});
