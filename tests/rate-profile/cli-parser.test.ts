import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { generateCLI, parseCLI } from "../../rate-profile/src/cli-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SINGLE_PROFILE_DIFF = `# Betaflight / STM32F7X2 4.5.1
# start the command batch
batch start

rateprofile 0

set thr_mid = 50
set thr_expo = 0
set rates_type = ACTUAL
set roll_rc_rate = 70
set roll_expo = 25
set pitch_rc_rate = 70
set pitch_expo = 25
set yaw_rc_rate = 60
set yaw_expo = 0
set roll_rate = 670
set pitch_rate = 670
set yaw_rate = 300
set throttle_limit_type = OFF
set throttle_limit_percent = 100

batch end
save`;

// A full "dump rates" that includes multiple rateprofile sections.
// rateprofile 0 has the user's custom values; rateprofile 1 has defaults
// that differ (0 for rates — the kind of value that makes the tool appear
// broken if imported by accident).
const MULTI_PROFILE_DUMP = `# Betaflight / STM32F7X2 4.5.1
batch start

rateprofile 0

set thr_mid = 50
set thr_expo = 0
set rates_type = ACTUAL
set roll_rc_rate = 70
set roll_expo = 25
set pitch_rc_rate = 70
set pitch_expo = 25
set yaw_rc_rate = 60
set yaw_expo = 0
set roll_rate = 670
set pitch_rate = 670
set yaw_rate = 300
set throttle_limit_type = OFF
set throttle_limit_percent = 100

rateprofile 1

set thr_mid = 50
set thr_expo = 0
set rates_type = ACTUAL
set roll_rc_rate = 0
set roll_expo = 0
set pitch_rc_rate = 0
set pitch_expo = 0
set yaw_rc_rate = 0
set yaw_expo = 0
set roll_rate = 0
set pitch_rate = 0
set yaw_rate = 0
set throttle_limit_type = OFF
set throttle_limit_percent = 100

batch end
save`;

// ---------------------------------------------------------------------------
// parseCLI — single profile
// ---------------------------------------------------------------------------

Deno.test("parseCLI - single profile: extracts roll_rc_rate", () => {
  const s = parseCLI(SINGLE_PROFILE_DIFF);
  assertEquals(s.roll_rc_rate, "70");
});

Deno.test("parseCLI - single profile: extracts roll_rate", () => {
  const s = parseCLI(SINGLE_PROFILE_DIFF);
  assertEquals(s.roll_rate, "670");
});

Deno.test("parseCLI - single profile: extracts roll_expo", () => {
  const s = parseCLI(SINGLE_PROFILE_DIFF);
  assertEquals(s.roll_expo, "25");
});

Deno.test("parseCLI - single profile: extracts thr_mid", () => {
  const s = parseCLI(SINGLE_PROFILE_DIFF);
  assertEquals(s.thr_mid, "50");
});

Deno.test("parseCLI - single profile: extracts throttle_limit_type", () => {
  const s = parseCLI(SINGLE_PROFILE_DIFF);
  assertEquals(s.throttle_limit_type, "OFF");
});

Deno.test("parseCLI - single profile: extracts throttle_limit_percent", () => {
  const s = parseCLI(SINGLE_PROFILE_DIFF);
  assertEquals(s.throttle_limit_percent, "100");
});

// ---------------------------------------------------------------------------
// parseCLI — multi-profile dump (the core import bug)
// ---------------------------------------------------------------------------

Deno.test("parseCLI - multi-profile dump: imports rateprofile 0, not last profile", () => {
  const s = parseCLI(MULTI_PROFILE_DUMP);
  // rateprofile 0 has roll_rc_rate=70; rateprofile 1 has roll_rc_rate=0.
  // The first occurrence (rateprofile 0) must win.
  assertEquals(s.roll_rc_rate, "70", "should import from rateprofile 0, not the last profile");
});

Deno.test("parseCLI - multi-profile dump: roll_rate from rateprofile 0", () => {
  const s = parseCLI(MULTI_PROFILE_DUMP);
  assertEquals(s.roll_rate, "670");
});

Deno.test("parseCLI - multi-profile dump: roll_expo from rateprofile 0", () => {
  const s = parseCLI(MULTI_PROFILE_DUMP);
  assertEquals(s.roll_expo, "25");
});

Deno.test("parseCLI - multi-profile dump: yaw_rate from rateprofile 0", () => {
  const s = parseCLI(MULTI_PROFILE_DUMP);
  assertEquals(s.yaw_rate, "300");
});

// ---------------------------------------------------------------------------
// parseCLI — edge cases
// ---------------------------------------------------------------------------

Deno.test("parseCLI - empty input returns empty object", () => {
  const s = parseCLI("");
  assertEquals(Object.keys(s).length, 0);
});

Deno.test("parseCLI - keys are lowercased", () => {
  const s = parseCLI("set ROLL_RC_RATE = 80");
  assertEquals(s.roll_rc_rate, "80");
});

Deno.test("parseCLI - parses lines without set prefix", () => {
  const s = parseCLI("roll_rc_rate = 80");
  assertEquals(s.roll_rc_rate, "80");
});

Deno.test("parseCLI - handles CRLF line endings", () => {
  const s = parseCLI("set roll_rc_rate = 70\r\nset roll_rate = 670\r\n");
  assertEquals(s.roll_rc_rate, "70");
  assertEquals(s.roll_rate, "670");
});

Deno.test("parseCLI - ignores comment lines", () => {
  const s = parseCLI("# Roll Rates\nset roll_rc_rate = 70");
  assertEquals(s.roll_rc_rate, "70");
  assertEquals("roll_rates" in s, false);
});

Deno.test("parseCLI - ignores non-set lines like rateprofile 0", () => {
  const s = parseCLI("rateprofile 0\nset roll_rc_rate = 70");
  assertEquals(s.roll_rc_rate, "70");
  assertEquals("rateprofile" in s, false);
});

Deno.test("parseCLI - rates_type is captured for type detection", () => {
  const s = parseCLI("set rates_type = BETAFLIGHT\nset roll_rc_rate = 100");
  assertEquals(s.rates_type, "BETAFLIGHT");
});

Deno.test("parseCLI - ACTUAL dump: extracts roll_srate as the max-rate key", () => {
  const s = parseCLI(
    "set rates_type = ACTUAL\nset roll_rc_rate = 30\nset roll_srate = 130\nset roll_expo = 30",
  );
  assertEquals(s.roll_srate, "130");
  assertEquals(s.roll_rc_rate, "30");
  assertEquals(s.roll_expo, "30");
});

Deno.test("parseCLI - when both roll_rate and roll_srate appear, first occurrence wins", () => {
  // In practice the importer (app.js) chooses srate over rate by mapping order,
  // but parseCLI itself just keeps the first-occurrence value for each key.
  const s = parseCLI("set roll_rate = 670\nset roll_srate = 130");
  assertEquals(s.roll_rate, "670");
  assertEquals(s.roll_srate, "130");
});

// ---------------------------------------------------------------------------
// generateCLI — round-trip sanity
// ---------------------------------------------------------------------------

Deno.test("generateCLI - ACTUAL profile round-trip: emits roll_srate", () => {
  const profile = {
    name: "Test",
    ratesType: "ACTUAL",
    rates: {
      roll: { center: 70, maxRate: 670, expo: 25 },
      pitch: { center: 70, maxRate: 670, expo: 25 },
      yaw: { center: 60, maxRate: 300, expo: 0 },
    },
    throttle: { mid: 50, expo: 0, limitType: "OFF", limitPercent: 100 },
  };
  const cli = generateCLI(profile);
  const s = parseCLI(cli);
  assertEquals(s.roll_rc_rate, "70");
  assertEquals(s.roll_srate, "670", "ACTUAL type must emit roll_srate, not roll_rate");
  assertEquals(s.roll_expo, "25");
  assertEquals(s.thr_mid, "50");
  assertEquals(s.throttle_limit_type, "OFF");
  assertEquals(s.throttle_limit_percent, "100");
  assertEquals(s.rates_type, "ACTUAL");
});

Deno.test("generateCLI - BETAFLIGHT profile round-trip: emits roll_rate", () => {
  const profile = {
    name: "BFTest",
    ratesType: "BETAFLIGHT",
    rates: {
      roll: { center: 100, maxRate: 70, expo: 20 },
      pitch: { center: 100, maxRate: 70, expo: 20 },
      yaw: { center: 90, maxRate: 50, expo: 10 },
    },
    throttle: { mid: 50, expo: 0, limitType: "OFF", limitPercent: 100 },
  };
  const cli = generateCLI(profile);
  const s = parseCLI(cli);
  assertEquals(s.roll_rc_rate, "100");
  assertEquals(s.roll_rate, "70", "BETAFLIGHT type must emit roll_rate (super rate)");
  assertEquals(s.roll_expo, "20");
  assertEquals(s.rates_type, "BETAFLIGHT");
});
