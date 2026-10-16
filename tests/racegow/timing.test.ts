import {
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildCommand, computeResults, quantizeTime } from "../../racegow/src/timing.js";
import { decodeState, encodeState, parseCommand } from "../../racegow/src/timing.js";

// Reference values verified against racegow_format.py output on a 30 fps clip.
const MARKS = { start: 4.2, l2: 11.35, l3: 18.57, end: 25.78 };

Deno.test("quantizeTime - snaps to the nearest frame boundary", () => {
  assertEquals(quantizeTime(25.78, 30), 773 / 30);
  assertEquals(quantizeTime(4.2, 30), 4.2);
});

Deno.test("quantizeTime - works with fractional rates like 29.97", () => {
  assertAlmostEquals(quantizeTime(10, 29.97), 10, 0.02);
});

Deno.test("computeResults - splits, total and hot lap match frame-quantized math", () => {
  const r = computeResults(MARKS, 30);
  assertEquals(r.errors, []);
  assertEquals(r.splits.map((s) => s.toFixed(2)), ["7.13", "7.23", "7.20"]);
  assertEquals(r.total.toFixed(2), "21.57");
  assertEquals(r.hotLap.toFixed(2), "7.13");
});

Deno.test("computeResults - rejects missing marks", () => {
  const r = computeResults({ start: 4.2, l2: null, l3: 18.57, end: 25.78 }, 30);
  assertStringIncludes(r.errors[0], "lap 2");
});

Deno.test("computeResults - rejects out-of-order marks", () => {
  const r = computeResults({ start: 4.2, l2: 18.57, l3: 8, end: 25.78 }, 30);
  assertStringIncludes(r.errors[0], "order");
});

Deno.test("buildCommand - emits racegow-format invocation with frame-grid times", () => {
  const cmd = buildCommand(MARKS, 30, "test_dvr.mp4");
  assertEquals(
    cmd,
    'racegow-format "test_dvr.mp4" --start 4.20000 --laps 11.33333 18.56667 --end 25.76667',
  );
});

Deno.test("buildCommand - falls back to a placeholder filename", () => {
  assertStringIncludes(buildCommand(MARKS, 30, ""), '"clip.mp4"');
});

Deno.test("parseCommand - round-trips buildCommand output", () => {
  const parsed = parseCommand(buildCommand(MARKS, 30, "my clip 42.mp4"));
  assertEquals(parsed?.filename, "my clip 42.mp4");
  // command carries 5-decimal frame-grid times — allow that rounding
  for (const k of ["start", "l2", "l3", "end"] as const) {
    assertAlmostEquals(parsed!.marks[k], quantizeTime(MARKS[k], 30), 1e-4);
  }
});

Deno.test("parseCommand - returns null on garbage", () => {
  assertEquals(parseCommand("hello there"), null);
  assertEquals(parseCommand('racegow-format "x.mp4" --start 1'), null);
});

Deno.test("encodeState/decodeState - round-trips full state", () => {
  const enc = encodeState(MARKS, 29.97, "my clip.mp4");
  const dec = decodeState("#" + enc);
  assertEquals(dec?.fps, 29.97);
  assertEquals(dec?.filename, "my clip.mp4");
  assertAlmostEquals(dec!.marks.start!, MARKS.start);
  assertAlmostEquals(dec!.marks.end!, MARKS.end);
});

Deno.test("decodeState - partial hash restores partial marks", () => {
  const dec = decodeState("#start=4.20000&end=25.76667");
  assertEquals(dec?.marks.start, 4.2);
  assertEquals(dec?.marks.l2, null);
  assertEquals(dec?.fps, 30);
});

Deno.test("decodeState - null for empty or junk hashes", () => {
  assertEquals(decodeState(""), null);
  assertEquals(decodeState("#"), null);
  assertEquals(decodeState("#foo=bar"), null);
});
