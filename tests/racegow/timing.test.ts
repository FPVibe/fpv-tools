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
    "racegow-format 'test_dvr.mp4' --start 4.20000 --laps 11.33333 18.56667 --end 25.76667",
  );
});

Deno.test("buildCommand - falls back to a placeholder filename", () => {
  assertStringIncludes(buildCommand(MARKS, 30, ""), "'clip.mp4'");
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

Deno.test("decodeState - rejects partial-number and non-positive tokens", () => {
  assertEquals(decodeState("#start=1.2junk&end=3"), null);
  assertEquals(decodeState("#fps=0&start=1&end=2"), null);
  assertEquals(decodeState("#fps=-5&start=1&end=2"), null);
  assertEquals(decodeState("#start=-1&end=2"), null);
});

Deno.test("decodeState - rejects overflowing (non-finite) numerals", () => {
  const huge = "9".repeat(400);
  assertEquals(decodeState(`#end=${huge}&start=1`), null);
  assertEquals(decodeState(`#fps=${huge}`), null);
});

Deno.test("decodeState - rejects fps outside the UI's 1-240 range", () => {
  assertEquals(decodeState("#fps=0.5&start=1&end=2"), null);
  assertEquals(decodeState("#fps=500&start=1&end=2"), null);
  assertEquals(decodeState("#fps=240&start=1&end=2")?.fps, 240);
});

Deno.test("buildCommand - windows form uses python + double quotes", () => {
  const cmd = buildCommand(MARKS, 30, "VID00111.mov", "windows");
  assertEquals(
    cmd,
    'python racegow_format.py "VID00111.mov" --start 4.20000 --laps 11.33333 18.56667 --end 25.76667',
  );
});

Deno.test("buildCommand - default form unchanged (posix)", () => {
  const cmd = buildCommand(MARKS, 30, "run.mp4");
  assertStringIncludes(cmd, "racegow-format 'run.mp4'");
});

Deno.test("encodeState/decodeState - os round-trips", () => {
  const dec = decodeState("#" + encodeState(MARKS, 30, "run.mp4", "windows"));
  assertEquals(dec?.os, "windows");
});

Deno.test("buildCommand - shell-quotes hostile filenames", () => {
  const cmd = buildCommand(MARKS, 30, "$(touch /tmp/pwned)`id`.mp4");
  assertStringIncludes(cmd, "'$(touch /tmp/pwned)`id`.mp4'");
  assertStringIncludes(cmd, "--start");
});

Deno.test("buildCommand - escapes embedded apostrophes", () => {
  const cmd = buildCommand(MARKS, 30, "cori's clip.mp4");
  assertStringIncludes(cmd, "racegow-format 'cori'\\''s clip.mp4' ");
});

Deno.test("parseCommand - round-trips shell-quoted names with apostrophes", () => {
  const parsed = parseCommand(buildCommand(MARKS, 30, "cori's clip.mp4"));
  assertEquals(parsed?.filename, "cori's clip.mp4");
});

Deno.test("parseCommand - still accepts legacy double-quoted commands", () => {
  const parsed = parseCommand(
    'racegow-format "old.mp4" --start 4.20000 --laps 11.33333 18.56667 --end 25.76667',
  );
  assertEquals(parsed?.filename, "old.mp4");
  assertAlmostEquals(parsed!.marks.start, 4.2, 1e-4);
});

Deno.test("parseCommand - rejects malformed numbers", () => {
  assertEquals(
    parseCommand('racegow-format "x.mp4" --start 1.2.3 --laps 2 3 --end 4'),
    null,
  );
  assertEquals(
    parseCommand('racegow-format "x.mp4" --start abc --laps 2 3 --end 4'),
    null,
  );
});
