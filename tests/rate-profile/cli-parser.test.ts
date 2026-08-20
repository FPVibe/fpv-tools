import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { generateCLI, parseAllRateProfiles, parseCLI } from "../../rate-profile/src/cli-parser.js";

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
  // ACTUAL rates store roll_srate as 1/10 of deg/s. maxRate=670 deg/s → roll_srate=67.
  assertEquals(s.roll_srate, "67", "ACTUAL maxRate 670 deg/s must emit roll_srate 67 (÷10)");
  assertEquals(s.roll_expo, "25");
  assertEquals(s.thr_mid, "50");
  assertEquals(s.throttle_limit_type, "OFF");
  assertEquals(s.throttle_limit_percent, "100");
  assertEquals(s.rates_type, "ACTUAL");
});

Deno.test("generateCLI - BETAFLIGHT profile round-trip: emits roll_srate", () => {
  // Modern Betaflight (4.x) uses roll_srate for super_rate in BETAFLIGHT mode,
  // with values in the 0-100 range (percentage, not deg/s).
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
  assertEquals(s.roll_srate, "70", "BETAFLIGHT type must emit roll_srate (super rate, 0-100)");
  assertEquals(s.roll_expo, "20");
  assertEquals(s.rates_type, "BETAFLIGHT");
});

// ---------------------------------------------------------------------------
// generateCLI — ACTUAL rates: roll_srate ÷10 scaling (regression for PR #45)
// ---------------------------------------------------------------------------

Deno.test("generateCLI - ACTUAL: maxRate 1100 emits roll_srate 110 (user-reported bug)", () => {
  // The Betaflight firmware stores ACTUAL max-rate in 1/10 deg/s units on the CLI.
  // A profile with 1100 deg/s max rate must emit roll_srate = 110, not 1100.
  // Before the fix, importing roll_srate=110 produced maxRate=110 → graph showed
  // 110 deg/s instead of 1100 deg/s.
  const profile = {
    ratesType: "ACTUAL",
    rates: {
      roll: { center: 16, maxRate: 1100, expo: 0 },
      pitch: { center: 16, maxRate: 1100, expo: 0 },
      yaw: { center: 16, maxRate: 1100, expo: 0 },
    },
    throttle: { mid: 50, expo: 0, limitType: "OFF", limitPercent: 100 },
  };
  const cli = generateCLI(profile);
  const s = parseCLI(cli);
  assertEquals(s.roll_srate, "110", "1100 deg/s must export as roll_srate=110");
  assertEquals(s.pitch_srate, "110");
  assertEquals(s.yaw_srate, "110");
});

Deno.test("generateCLI - ACTUAL: round-trips roll_srate through ÷10/×10 scaling", () => {
  // generateCLI divides maxRate by 10 for ACTUAL; if that CLI is re-imported
  // with the ×10 scale factor, the deg/s value is recovered exactly.
  const internalDegPerSec = 1100;
  const profile = {
    ratesType: "ACTUAL",
    rates: {
      roll: { center: 16, maxRate: internalDegPerSec, expo: 0 },
      pitch: { center: 16, maxRate: internalDegPerSec, expo: 0 },
      yaw: { center: 16, maxRate: internalDegPerSec, expo: 0 },
    },
    throttle: { mid: 50, expo: 0, limitType: "OFF", limitPercent: 100 },
  };
  const cli = generateCLI(profile);
  const s = parseCLI(cli);
  // The emitted CLI value should be the internal deg/s ÷ 10.
  const emittedSrate = parseInt(s.roll_srate, 10);
  // Re-applying ×10 (the import step) must recover the original deg/s value.
  assertEquals(emittedSrate * 10, internalDegPerSec);
});

Deno.test("generateCLI - BETAFLIGHT: roll_srate emitted without scaling (super rate %)", () => {
  // BETAFLIGHT super rate is 0-100%; no ÷10 scaling applied.
  const profile = {
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
  // BF maxRate=70 (70% super rate) must emit roll_srate=70 (no scaling).
  assertEquals(s.roll_srate, "70", "BETAFLIGHT maxRate 70 must emit roll_srate=70 unchanged");
});

Deno.test("parseCLI - BETAFLIGHT dump: captures roll_srate key (type-agnostic key capture)", () => {
  // parseCLI is type-agnostic: it captures every `set key = value` line it
  // sees, regardless of rates_type.  This test confirms roll_srate is not
  // accidentally filtered out for BETAFLIGHT dumps.
  //
  // The actual import mapping (roll_srate → profileObj.rates.roll.maxRate
  // when ratesType is BETAFLIGHT) lives in app.js and is exercised by
  // manual / integration testing.  This test guards the parser layer only.
  const bfDump = [
    "set rates_type = BETAFLIGHT",
    "set roll_rc_rate = 150",
    "set roll_srate = 70",
    "set roll_expo = 0",
  ].join("\n");
  const s = parseCLI(bfDump);
  assertEquals(s.rates_type, "BETAFLIGHT");
  assertEquals(s.roll_rc_rate, "150");
  assertEquals(s.roll_srate, "70", "roll_srate must be captured for BETAFLIGHT imports");
});

// ---------------------------------------------------------------------------
// parseAllRateProfiles
// ---------------------------------------------------------------------------

const DUMP_TWO_RATEPROFILES = `# Betaflight / STM32F7X2 4.5.1
batch start

rateprofile 0

set rates_type = ACTUAL
set roll_rc_rate = 70
set roll_expo = 25
set roll_rate = 670
set thr_mid = 50

rateprofile 1

set rates_type = ACTUAL
set roll_rc_rate = 100
set roll_expo = 40
set roll_rate = 800
set thr_mid = 55

batch end
save`;

const DUMP_THREE_RATEPROFILES = `# Betaflight / STM32F7X2 4.5.1
batch start

rateprofile 0

set rates_type = ACTUAL
set roll_rc_rate = 70
set roll_rate = 670

rateprofile 1

set rates_type = ACTUAL
set roll_rc_rate = 100
set roll_rate = 800

rateprofile 2

set rates_type = ACTUAL
set roll_rc_rate = 120
set roll_rate = 900

batch end
save`;

Deno.test("parseAllRateProfiles - returns empty array when no rateprofile sections", () => {
  const result = parseAllRateProfiles("set roll_rc_rate = 70\nsave");
  assertEquals(result.length, 0);
});

Deno.test("parseAllRateProfiles - returns empty array for empty input", () => {
  assertEquals(parseAllRateProfiles("").length, 0);
});

Deno.test("parseAllRateProfiles - single rateprofile section", () => {
  const result = parseAllRateProfiles(SINGLE_PROFILE_DIFF);
  assertEquals(result.length, 1);
  assertEquals(result[0].roll_rc_rate, "70");
  assertEquals(result[0].roll_rate, "670");
});

Deno.test("parseAllRateProfiles - returns one entry per rateprofile section", () => {
  const result = parseAllRateProfiles(DUMP_TWO_RATEPROFILES);
  assertEquals(result.length, 2);
});

Deno.test("parseAllRateProfiles - rateprofile 0 settings are correct", () => {
  const result = parseAllRateProfiles(DUMP_TWO_RATEPROFILES);
  assertEquals(result[0].roll_rc_rate, "70");
  assertEquals(result[0].roll_rate, "670");
  assertEquals(result[0].roll_expo, "25");
  assertEquals(result[0].thr_mid, "50");
});

Deno.test("parseAllRateProfiles - rateprofile 1 settings are correct", () => {
  const result = parseAllRateProfiles(DUMP_TWO_RATEPROFILES);
  assertEquals(result[1].roll_rc_rate, "100");
  assertEquals(result[1].roll_rate, "800");
  assertEquals(result[1].roll_expo, "40");
  assertEquals(result[1].thr_mid, "55");
});

Deno.test("parseAllRateProfiles - each section is independent (no value bleed-through)", () => {
  // rateprofile 0 has thr_mid=50; rateprofile 1 has thr_mid=55.
  // The values must not bleed from one section into the other.
  const result = parseAllRateProfiles(DUMP_TWO_RATEPROFILES);
  assertEquals(result[0].thr_mid, "50");
  assertEquals(result[1].thr_mid, "55");
});

Deno.test("parseAllRateProfiles - handles three rateprofile sections", () => {
  const result = parseAllRateProfiles(DUMP_THREE_RATEPROFILES);
  assertEquals(result.length, 3);
  assertEquals(result[0].roll_rc_rate, "70");
  assertEquals(result[1].roll_rc_rate, "100");
  assertEquals(result[2].roll_rc_rate, "120");
});

Deno.test("parseAllRateProfiles - handles CRLF line endings", () => {
  const crlf = DUMP_TWO_RATEPROFILES.replace(/\n/g, "\r\n");
  const result = parseAllRateProfiles(crlf);
  assertEquals(result.length, 2);
  assertEquals(result[0].roll_rc_rate, "70");
  assertEquals(result[1].roll_rc_rate, "100");
});

Deno.test("parseAllRateProfiles - skips empty rateprofile sections (all defaults)", () => {
  // A section with no set commands (e.g. blank lines only) should not appear.
  const dumpWithEmptySection = `rateprofile 0\n\nrateprofile 1\n\nset roll_rc_rate = 70\n`;
  const result = parseAllRateProfiles(dumpWithEmptySection);
  // rateprofile 0 section is empty; only rateprofile 1 has settings
  assertEquals(result.length, 1);
  assertEquals(result[0].roll_rc_rate, "70");
});
